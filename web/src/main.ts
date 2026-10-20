import * as THREE from "three";
import { VISUAL, getFftBandsByEqualizerRange, EQ_BAND_DEFINITIONS } from "./config";
import { audioUniforms, sphere } from "./sphere";
import { composer, renderer } from "./scene";
import { chartPanel, drawEqSpectrumChart } from "./equalizerChart";
import { bands, smoothedBands, smoothedSpectrumBands } from "./websocket";
import "./gui";

const fftBandsByEqualizerRange = getFftBandsByEqualizerRange();

document.body.appendChild(renderer.domElement);

document.body.appendChild(chartPanel);

const clock = new THREE.Clock();

let animatedRotationY = 0;

const animate = () => {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  audioUniforms.uTime.value += delta;

  // Suaviza cada banda para que la malla responda sin saltos bruscos.
  let globalEnergy = 0;
  for (let band = 0; band < bands.length; band += 1) {
    const rawLevel = THREE.MathUtils.clamp(bands[band], 0, 1);
    const spectrumSpeed = rawLevel > smoothedSpectrumBands[band]
      ? VISUAL.attackSpeed
      : VISUAL.releaseSpeed;
    const spectrumSmoothing = 1 - Math.exp(-delta * spectrumSpeed);
    smoothedSpectrumBands[band] +=
      (rawLevel - smoothedSpectrumBands[band]) * spectrumSmoothing;
  }
  for (let group = 0; group < EQ_BAND_DEFINITIONS.length; group += 1) {
    const groupDefinition = EQ_BAND_DEFINITIONS[group];
    const gain = VISUAL.equalizer[groupDefinition.key];
    let groupPeak = 0;
    for (const fftBand of fftBandsByEqualizerRange[group]) {
      groupPeak = Math.max(groupPeak, smoothedSpectrumBands[fftBand]);
    }
    const level = Math.min(1, groupPeak * gain);
    const speed = level > smoothedBands[group]
      ? VISUAL.attackSpeed
      : VISUAL.releaseSpeed;
    const smoothing = 1 - Math.exp(-delta * speed);
    smoothedBands[group] += (level - smoothedBands[group]) * smoothing;
    globalEnergy += smoothedBands[group] * smoothedBands[group];
  }
  const globalAmplitude = Math.sqrt(globalEnergy / smoothedBands.length);
  drawEqSpectrumChart(smoothedSpectrumBands);
  audioUniforms.uGlobalAmplitude.value = globalAmplitude;
  audioUniforms.uBands.value.set(smoothedBands);
  sphere.scale.setScalar(
    VISUAL.sphereSize * (1 + globalAmplitude * VISUAL.globalScaleByAudio),
  );
  animatedRotationY += delta * VISUAL.rotationSpeed;
  sphere.rotation.y = THREE.MathUtils.degToRad(VISUAL.rotationOffset) + animatedRotationY;
  composer.render();
};

animate();
