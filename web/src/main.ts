import * as THREE from "three";
import { VISUAL, FREQUENCY, getEqualizerRanges, getFftBandsByEqualizerRange, NYQUIST_HZ, FFT_BANDS, EQ_BAND_DEFINITIONS, CrossoverKey, MIN_CROSSOVER_GAP_HZ } from "./config";
import { audioUniforms, sphere, sphereGeometry, sphereMaterial, updateSphereColors } from "./sphere";
import { bloomPass, camera, composer, floor, floorMaterial, renderer, scene } from "./scene";
import { chartPanel, drawEqSpectrumChart } from "./equalizerChart";


let fftBandsByEqualizerRange = getFftBandsByEqualizerRange();

document.body.appendChild(renderer.domElement);

document.body.appendChild(chartPanel);

void import("lil-gui").then(({ default: GUI }) => {
  const gui = new GUI({ title: "Ajustes del visualizador" });
  const sceneFolder = gui.addFolder("Escena");
  sceneFolder.addColor(VISUAL, "backgroundColor").name("Fondo").onChange((color: number) => {
    scene.background = new THREE.Color(color);
  });

  const sphereFolder = gui.addFolder("Esfera");
  sphereFolder.add(VISUAL, "sphereSize", 0.5, 8, 0.1).name("Tamano").onChange((size: number) => {
    sphere.scale.setScalar(size);
  });
  sphereFolder.add(VISUAL, "detail", 1, 30, 1).name("Detalle").onFinishChange((detail: number) => {
    const nextGeometry = new THREE.IcosahedronGeometry(1, detail);
    updateSphereColors(nextGeometry);
    sphere.geometry.dispose();
    sphere.geometry = nextGeometry;
    // sphereGeometry = nextGeometry;
  });
  sphereFolder.add(VISUAL, "wireOpacity", 0, 1, 0.01).name("Opacidad").onChange((opacity: number) => {
    sphereMaterial.opacity = opacity;
  });
  sphereFolder.add(VISUAL, "colorHueStart", 0, 1, 0.01).name("Tono inicial").onChange(() => updateSphereColors(sphereGeometry));
  sphereFolder.add(VISUAL, "colorHueRange", -1, 1, 0.01).name("Rango de tono").onChange(() => updateSphereColors(sphereGeometry));
  sphereFolder.add(VISUAL, "colorSaturation", 0, 1, 0.01).name("Saturacion").onChange(() => updateSphereColors(sphereGeometry));
  sphereFolder.add(VISUAL, "colorLightness", 0, 1, 0.01).name("Luminosidad").onChange(() => updateSphereColors(sphereGeometry));

  const audioFolder = gui.addFolder("Audio y deformacion");
  audioFolder.add(VISUAL, "audioDeformation", 0, 5, 0.01).name("Fuerza de audio").onChange((value: number) => {
    audioUniforms.uAudioDeformation.value = value;
  });
  const poleFolder = gui.addFolder("Polos y volumen global");
  poleFolder.add(VISUAL, "poleInfluence", 0, 1, 0.01).name("Influencia en polos").onChange((value: number) => {
    audioUniforms.uPoleInfluence.value = value;
  });
  poleFolder.add(VISUAL, "poleBlend", 0.25, 8, 0.05).name("Concentracion en polos").onChange((value: number) => {
    audioUniforms.uPoleBlend.value = value;
  });
  poleFolder.add(VISUAL, "seamInfluence", 0, 1, 0.01).name("Influencia en costura").onChange((value: number) => {
    audioUniforms.uSeamInfluence.value = value;
  });
  poleFolder.add(VISUAL, "seamWidth", 1, 90, 1).name("Ancho costura (grados)").onChange((value: number) => {
    audioUniforms.uSeamWidth.value = value;
  });
  poleFolder.add(VISUAL, "globalScaleByAudio", 0, 2, 0.01).name("Escala global por audio");
  audioFolder.add(VISUAL, "noiseScale", 0.1, 10, 0.1).name("Escala del ruido").onChange((value: number) => {
    audioUniforms.uNoiseScale.value = value;
  });
  audioFolder.add(VISUAL, "noiseSpeed", 0, 3, 0.01).name("Velocidad del ruido").onChange((value: number) => {
    audioUniforms.uNoiseSpeed.value = value;
  });
  audioFolder.add(VISUAL, "noiseInfluence", 0, 2, 0.01).name("Influencia del ruido").onChange((value: number) => {
    audioUniforms.uNoiseInfluence.value = value;
  });
  audioFolder.add(VISUAL, "noiseAmount", 0, 1, 0.01).name("Relieve sin audio").onChange((value: number) => {
    audioUniforms.uNoiseAmount.value = value;
  });
  audioFolder.add(VISUAL, "sectorEdgeBlend", 0, 1, 0.001).name("Suavizado bordes sector").onChange((value: number) => {
    audioUniforms.uSectorEdgeBlend.value = value;
  });

  const equalizerFolder = gui.addFolder("Ecualizador visual");
  for (const band of EQ_BAND_DEFINITIONS) {
    equalizerFolder.add(VISUAL.equalizer, band.key, 0, 8, 0.1).name(band.label);
  }

  const frequencyFolder = gui.addFolder("Rango de frecuencias");
  const floorController = frequencyFolder
    .add(FREQUENCY, "floorHz", 20, NYQUIST_HZ, 1)
    .name("Piso (Hz)")
    .onChange(refreshFrequencyControls);
  const ceilingController = frequencyFolder
    .add(FREQUENCY, "ceilingHz", 20, NYQUIST_HZ, 1)
    .name("Techo (Hz)")
    .onChange(refreshFrequencyControls);
  const crossoverControllers = EQ_BAND_DEFINITIONS.slice(0, -1).map((band) => {
    const key = band.key as CrossoverKey;
    const controller = frequencyFolder
      .add(FREQUENCY.crossovers, key, 20, NYQUIST_HZ, 1)
      .name(`${band.label} hasta (Hz)`)
      .onChange(refreshFrequencyControls);
    return { key, label: band.label, controller };
  });
  function refreshFrequencyControls() {
    fftBandsByEqualizerRange = getFftBandsByEqualizerRange();
    const crossoverValues = crossoverControllers.map(({ key }) =>
      FREQUENCY.crossovers[key],
    );
    floorController.min(20).max(crossoverValues[0] - MIN_CROSSOVER_GAP_HZ);
    ceilingController
      .min(crossoverValues[crossoverValues.length - 1] + MIN_CROSSOVER_GAP_HZ)
      .max(NYQUIST_HZ);
    floorController.updateDisplay();
    ceilingController.updateDisplay();

    crossoverControllers.forEach(({ label, controller }, index) => {
      const previousHz = index === 0 ? FREQUENCY.floorHz : crossoverValues[index - 1];
      const nextHz = index === crossoverValues.length - 1
        ? FREQUENCY.ceilingHz
        : crossoverValues[index + 1];
      controller
        .min(previousHz + MIN_CROSSOVER_GAP_HZ)
        .max(nextHz - MIN_CROSSOVER_GAP_HZ)
        .name(`${label} hasta (Hz)`)
        .updateDisplay();
    });

    const ranges = getEqualizerRanges();
    for (const [index, band] of EQ_BAND_DEFINITIONS.entries()) {
      equalizerFolder.controllers
        .find((controller) => controller.property === band.key)
        ?.name(`${band.label} (${Math.round(ranges[index].minHz)}-${Math.round(ranges[index].maxHz)} Hz)`);
    }
  }
  refreshFrequencyControls();

  const responseFolder = gui.addFolder("Respuesta");
  responseFolder.add(VISUAL, "attackSpeed", 1, 60, 1).name("Ataque");
  responseFolder.add(VISUAL, "releaseSpeed", 1, 40, 1).name("Relajacion");

  const rotationFolder = gui.addFolder("Rotacion");
  rotationFolder.add(VISUAL, "rotationOffset", -180, 180, 1).name("Offset (grados)");
  rotationFolder.add(VISUAL, "rotationSpeed", -2, 2, 0.01).name("Velocidad");

  const floorFolder = gui.addFolder("Piso");
  floorFolder.addColor(VISUAL, "floorColor").name("Color").onChange((color: number) => {
    floorMaterial.color.set(color);
  });
  floorFolder.add(VISUAL, "floorSize", 0, 100, 1).name("Tamano").onChange((size: number) => {
    floor.scale.setScalar(size);
  });

  const bloomFolder = gui.addFolder("Bloom");
  bloomFolder.add(VISUAL, "bloomStrength", 0, 3, 0.01).name("Intensidad").onChange((value: number) => {
    bloomPass.strength = value;
  });
  bloomFolder.add(VISUAL, "bloomRadius", 0, 1, 0.01).name("Radio").onChange((value: number) => {
    bloomPass.radius = value;
  });
  bloomFolder.add(VISUAL, "bloomThreshold", 0, 1, 0.01).name("Umbral").onChange((value: number) => {
    bloomPass.threshold = value;
  });

  for (const folder of [
    sceneFolder,
    sphereFolder,
    audioFolder,
    poleFolder,
    equalizerFolder,
    frequencyFolder,
    responseFolder,
    rotationFolder,
    floorFolder,
    bloomFolder,
  ]) {
    folder.close();
  }
});

let bands = new Float32Array(FFT_BANDS);
const smoothedBands = new Float32Array(EQ_BAND_DEFINITIONS.length);
const smoothedSpectrumBands = new Float32Array(FFT_BANDS);
// El servidor Rust envia las bandas de frecuencia por este WebSocket local.
const socket = new WebSocket("ws://127.0.0.1:9001");
socket.addEventListener("message", (event: MessageEvent<string>) => {
  const values: unknown = JSON.parse(event.data);
  if (
    Array.isArray(values) &&
    values.length === bands.length &&
    values.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    bands = Float32Array.from(values);
  }
});
socket.addEventListener("error", () => {
  console.error("No se pudo conectar con el backend Rust en ws://127.0.0.1:9001");
});

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

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
