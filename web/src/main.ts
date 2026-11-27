import * as THREE from "three";
import { VISUAL, loadConfig } from "./config";
import { audioUniforms, sphere } from "./sphere";
import { composer, renderer } from "./scene";
import { chartPanel, drawEqSpectrumChart } from "./equalizerChart";
import { processAudioFrame } from "./audio";
import { syncGuiAndSceneFromConfig } from "./gui";

loadConfig().then(syncGuiAndSceneFromConfig);

document.body.appendChild(renderer.domElement);

document.body.appendChild(chartPanel);

const clock = new THREE.Clock();

let animatedRotationY = 0;

const animate = () => {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  audioUniforms.uTime.value += delta;

  const { smoothedBands, globalAmplitude, smoothedSpectrumBands } = processAudioFrame(delta);
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