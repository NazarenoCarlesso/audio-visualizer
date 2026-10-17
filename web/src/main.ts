import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import classicNoise3D from "./classicnoise3D.glsl?raw";

// AJUSTES RAPIDOS: cambia estos valores para personalizar la escena.
const VISUAL = {
  backgroundColor: 0x000000, // Fondo de la pagina.
  sphereSize: 3, // Tamano general del icosaedro.
  detail: 30, // Detalle de la malla; bajalo si el equipo va lento.
  wireOpacity: 0.5, // Opacidad de la malla (0 = invisible, 1 = opaca).
  audioDeformation: 1.66, // Fuerza con la que el volumen de audio empuja la superficie.
  poleInfluence: 0.75, // Mezcla sonido global en los polos (0 = desactivado).
  poleBlend: 2, // A mayor valor, el efecto global queda concentrado cerca de los polos.
  seamInfluence: 0.75, // Mezcla las bandas en la union entre agudos y graves.
  seamWidth: 12, // Ancho angular de la mezcla a cada lado de la costura, en grados.
  globalScaleByAudio: 0.05, // Cuanto crece la esfera con el volumen global (0 = desactivado).
  noiseScale: 3.0, // Tamano de las formas del ruido: menor = formas mas grandes.
  noiseSpeed: 0.25, // Velocidad a la que el patron de ruido se desplaza.
  noiseInfluence: 0.8, // Cuanto varia el audio entre distintas zonas de la esfera.
  noiseAmount: 0.02, // Relieve sutil aun cuando no hay sonido.
  colorHueStart: 0, // Color inicial; el tono HSL va de 0 a 1.
  colorHueRange: 0, // Cuanto cambia el tono alrededor de la esfera.
  colorSaturation: 1, // Intensidad del color (0 = gris, 1 = intenso).
  colorLightness: 0.55, // Luminosidad; debe ser alta para que el bloom ilumine la malla.
  floorColor: 0x000000, // Color del plano.
  floorSize: 0, // Ancho y largo del plano.
  bloomStrength: 1.2, // Intensidad del halo.
  bloomRadius: 0.1, // Tamano y suavidad del halo.
  bloomThreshold: 0.1, // Brillo minimo de los pixeles que generan bloom.
  attackSpeed: 24, // Rapidez con la que la malla responde al sonido.
  releaseSpeed: 12, // Rapidez con la que vuelve a su forma base.
  rotationSpeed: 0.2, // Velocidad de rotacion.
  // Giro inicial en grados sobre el eje Y, igual que la rotacion continua.
  rotationOffset: 0,
  // Ganancia de cada sector; sus rangos de frecuencia se configuran abajo en FREQUENCY.
  equalizer: {
    subBass: 1.2,
    bass: 0.7,
    lowMids: 0.9,
    mids: 0.7,
    upperMids: 0.8,
    presence: 1.1,
    brilliance: 1.2,
    air: 1.5,
  },
};

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 2_048;
const FFT_BANDS = 64;
const NYQUIST_HZ = SAMPLE_RATE / 2;
const MIN_CROSSOVER_GAP_HZ = 1;
const EQ_BAND_DEFINITIONS = [
  { key: "subBass", label: "Subgraves", crossoverKey: "subBass" },
  { key: "bass", label: "Graves", crossoverKey: "bass" },
  { key: "lowMids", label: "Medios graves", crossoverKey: "lowMids" },
  { key: "mids", label: "Medios", crossoverKey: "mids" },
  { key: "upperMids", label: "Medios altos", crossoverKey: "upperMids" },
  { key: "presence", label: "Presencia", crossoverKey: "presence" },
  { key: "brilliance", label: "Brillo", crossoverKey: "brilliance" },
  { key: "air", label: "Aire" },
] as const;
type EqualizerBandKey = typeof EQ_BAND_DEFINITIONS[number]["key"];
type CrossoverKey = Exclude<EqualizerBandKey, "air">;
const FREQUENCY = {
  floorHz: 63,
  ceilingHz: 6_000,
  crossovers: {
    subBass: 125,
    bass: 194,
    lowMids: 254,
    mids: 346,
    upperMids: 664,
    presence: 1_450,
    brilliance: 3_456,
  } satisfies Record<CrossoverKey, number>,
};
const getEqualizerRanges = () => {
  let minHz = FREQUENCY.floorHz;
  return EQ_BAND_DEFINITIONS.map((band) => {
    const maxHz = "crossoverKey" in band
      ? FREQUENCY.crossovers[band.crossoverKey]
      : FREQUENCY.ceilingHz;
    const range = { key: band.key, label: band.label, minHz, maxHz };
    minHz = maxHz;
    return range;
  });
};
const FFT_BAND_CENTER_HZ = Array.from({ length: FFT_BANDS }, (_, band) => {
  const maxBin = FFT_SIZE / 2;
  const start = Math.max(
    1,
    Math.floor(maxBin ** (band / FFT_BANDS)),
  );
  const end = Math.min(
    maxBin + 1,
    Math.max(start + 1, Math.ceil(maxBin ** ((band + 1) / FFT_BANDS))),
  );
  return ((start + end) * 0.5 * SAMPLE_RATE) / FFT_SIZE;
});
const getFftBandsByEqualizerRange = () =>
  getEqualizerRanges().map((range) =>
    FFT_BAND_CENTER_HZ.flatMap((centerHz, index) =>
      centerHz >= range.minHz && centerHz < range.maxHz ? [index] : [],
    ),
  );
let fftBandsByEqualizerRange = getFftBandsByEqualizerRange();
const chartCanvas = document.createElement("canvas");
chartCanvas.width = 960;
chartCanvas.height = 588;
chartCanvas.style.cssText = "display:block;width:100%;height:auto;aspect-ratio:18/11";
const chartPanel = document.createElement("div");
chartPanel.style.cssText = [
  "position:fixed",
  "top:12px",
  "left:12px",
  "width:min(480px,calc(100vw - 24px))",
  "padding:8px",
  "box-sizing:border-box",
  "border:1px solid rgba(180,210,255,.2)",
  "border-radius:6px",
  "background:rgba(9,13,24,.84)",
  "z-index:2",
  "overflow:hidden",
].join(";");
const chartHeader = document.createElement("button");
chartHeader.type = "button";
chartHeader.textContent = "＋ Ecualizador y espectro";
chartHeader.setAttribute("aria-expanded", "false");
chartHeader.style.cssText = [
  "display:block",
  "width:100%",
  "padding:8px 10px",
  "border:0",
  "background:transparent",
  "color:#e8edf7",
  "font:12px system-ui,sans-serif",
  "text-align:left",
  "cursor:pointer",
].join(";");
chartCanvas.style.display = "none";
chartHeader.addEventListener("click", () => {
  const isCollapsed = chartCanvas.style.display !== "none";
  chartCanvas.style.display = isCollapsed ? "none" : "block";
  chartHeader.textContent = isCollapsed
    ? "＋ Ecualizador y espectro"
    : "− Ecualizador y espectro";
  chartHeader.setAttribute("aria-expanded", String(!isCollapsed));
});
chartPanel.append(chartHeader, chartCanvas);
document.body.appendChild(chartPanel);

const drawEqSpectrumChart = (spectrum: Float32Array) => {
  const context = chartCanvas.getContext("2d");
  if (!context) return;

  const width = 480;
  const height = 294;
  const left = 52;
  const right = 44;
  const top = 36;
  const bottom = 40;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const minHz = 20;
  const maxHz = NYQUIST_HZ;
  const equalizerRanges = getEqualizerRanges();
  const logMin = Math.log(minHz);
  const logRange = Math.log(maxHz) - logMin;
  const xForHz = (hz: number) =>
    left + (Math.log(THREE.MathUtils.clamp(hz, minHz, maxHz)) - logMin) / logRange * plotWidth;
  const yForGain = (gain: number) => top + (1 - gain / 8) * plotHeight;
  const yForLevel = (level: number) => top + (1 - level) * plotHeight;

  context.setTransform(2, 0, 0, 2, 0, 0);
  context.clearRect(0, 0, width, height);
  context.font = "10px system-ui, sans-serif";
  context.textBaseline = "middle";

  context.fillStyle = "#e8edf7";
  context.textAlign = "left";
  context.fillText("Ecualizador y espectro en vivo", left, 11);
  context.fillStyle = "#ffca70";
  context.fillRect(left, 21, 10, 2);
  context.fillText("Ganancia", left + 14, 22);
  context.fillStyle = "#55c8ff";
  context.fillRect(left + 87, 21, 10, 2);
  context.fillText("Audio normalizado, sin ecualizar", left + 101, 22);

  const activeStartX = xForHz(FREQUENCY.floorHz);
  const activeEndX = xForHz(FREQUENCY.ceilingHz);
  context.fillStyle = "rgba(3,7,15,.58)";
  context.fillRect(left, top, activeStartX - left, plotHeight);
  context.fillRect(activeEndX, top, width - right - activeEndX, plotHeight);

  context.strokeStyle = "rgba(190,210,240,.16)";
  context.lineWidth = 1;
  context.fillStyle = "rgba(220,230,245,.7)";
  context.textAlign = "right";
  for (const gain of [0, 1, 4, 8]) {
    const y = yForGain(gain);
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
    context.fillText(`${gain}x`, left - 6, y);
  }
  context.textAlign = "left";
  for (const level of [0, 0.5, 1]) {
    context.fillText(`${level}`, width - right + 5, yForLevel(level));
  }

  const ticks = [
    [31, "31"],
    [63, "63"],
    [125, "125"],
    [250, "250"],
    [500, "500"],
    [1_000, "1k"],
    [2_000, "2k"],
    [4_000, "4k"],
    [8_000, "8k"],
    [16_000, "16k"],
  ] as const;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillStyle = "rgba(220,230,245,.7)";
  context.strokeStyle = "rgba(190,210,240,.12)";
  for (const [frequency, label] of ticks) {
    const x = xForHz(frequency);
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, height - bottom);
    context.stroke();
    context.fillText(label, x, height - bottom + 5);
  }

  context.fillStyle = "rgba(85,200,255,.38)";
  for (let band = 0; band < spectrum.length; band += 1) {
    const x = xForHz(FFT_BAND_CENTER_HZ[band]);
    const previousX = band === 0 ? x : xForHz(FFT_BAND_CENTER_HZ[band - 1]);
    const nextX = band === spectrum.length - 1
      ? x
      : xForHz(FFT_BAND_CENTER_HZ[band + 1]);
    const barWidth = Math.max(2, (nextX - previousX) * 0.72);
    const y = yForLevel(spectrum[band]);
    const isActive = FFT_BAND_CENTER_HZ[band] >= FREQUENCY.floorHz &&
      FFT_BAND_CENTER_HZ[band] < FREQUENCY.ceilingHz;
    context.fillStyle = isActive ? "rgba(85,200,255,.48)" : "rgba(110,125,150,.25)";
    context.fillRect(x - barWidth / 2, y, barWidth, height - bottom - y);
  }

  context.strokeStyle = "rgba(255,202,112,.7)";
  context.lineWidth = 1;
  for (const boundaryHz of [
    FREQUENCY.floorHz,
    ...Object.values(FREQUENCY.crossovers),
    FREQUENCY.ceilingHz,
  ]) {
    const x = xForHz(boundaryHz);
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, height - bottom);
    context.stroke();
  }

  context.strokeStyle = "#ffca70";
  context.lineWidth = 2;
  context.beginPath();
  equalizerRanges.forEach((range, index) => {
    const startHz = Math.max(range.minHz, minHz);
    const endHz = Math.min(range.maxHz, maxHz);
    if (startHz >= maxHz || endHz <= minHz) return;
    const xStart = xForHz(startHz);
    const xEnd = xForHz(endHz);
    const y = yForGain(VISUAL.equalizer[range.key as EqualizerBandKey]);
    if (index === 0 || xStart === left) {
      context.moveTo(xStart, y);
    } else {
      context.lineTo(xStart, y);
    }
    context.lineTo(xEnd, y);
    const nextRange = equalizerRanges[index + 1];
    if (nextRange && endHz < maxHz) {
      context.lineTo(xEnd, yForGain(VISUAL.equalizer[nextRange.key as EqualizerBandKey]));
    }
  });
  context.stroke();
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(VISUAL.backgroundColor);

const camera = new THREE.PerspectiveCamera(
  120,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 2.6, 6);
camera.lookAt(0, 0.8, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

scene.add(new THREE.HemisphereLight(0xc8e3ff, 0x182033, 2));
const keyLight = new THREE.DirectionalLight(0xffffff, 3);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

let sphereGeometry = new THREE.IcosahedronGeometry(1, VISUAL.detail);
const vertexColor = new THREE.Color();
const updateSphereColors = (geometry: THREE.BufferGeometry) => {
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const x = positions.getX(vertex);
    const z = positions.getZ(vertex);
    // Usa la direccion del punto para repartir el degradado de color alrededor de la malla.
    const angle = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2);
    vertexColor.setHSL(
      VISUAL.colorHueStart + angle * VISUAL.colorHueRange,
      VISUAL.colorSaturation,
      VISUAL.colorLightness,
    );
    vertexColor.toArray(colors, vertex * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
};
updateSphereColors(sphereGeometry);

// El shader comparte con Rust las bandas ya suavizadas y calcula el desplazamiento
// en la GPU. `cnoise` aporta variacion organica al relieve del audio.
const audioUniforms = {
  uTime: { value: 0 },
  uBands: { value: new Float32Array(EQ_BAND_DEFINITIONS.length) },
  uGlobalAmplitude: { value: 0 },
  uAudioDeformation: { value: VISUAL.audioDeformation },
  uPoleInfluence: { value: VISUAL.poleInfluence },
  uPoleBlend: { value: VISUAL.poleBlend },
  uSeamInfluence: { value: VISUAL.seamInfluence },
  uSeamWidth: { value: VISUAL.seamWidth },
  uNoiseScale: { value: VISUAL.noiseScale },
  uNoiseSpeed: { value: VISUAL.noiseSpeed },
  uNoiseInfluence: { value: VISUAL.noiseInfluence },
  uNoiseAmount: { value: VISUAL.noiseAmount },
};
const sphereMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  wireframe: true,
  transparent: true,
  opacity: VISUAL.wireOpacity,
  blending: THREE.NormalBlending,
  depthWrite: false,
});
sphereMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, audioUniforms);
  shader.vertexShader = shader.vertexShader.replace(
    "#include <common>",
    `#include <common>
${classicNoise3D}
uniform float uTime;
uniform float uBands[8];
uniform float uGlobalAmplitude;
uniform float uAudioDeformation;
uniform float uPoleInfluence;
uniform float uPoleBlend;
uniform float uSeamInfluence;
uniform float uSeamWidth;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uNoiseInfluence;
uniform float uNoiseAmount;`,
  );
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `vec3 transformed = vec3(position);
vec3 direction = normalize(position);
// El angulo divide la esfera en ocho sectores iguales, uno por grupo de frecuencias.
float angle = (atan(direction.z, direction.x) + 3.14159265) / 6.2831853;
float sectorPosition = angle * 8.0;
int sector = int(floor(sectorPosition)) % 8;
int previousSector = (sector + 7) % 8;
int nextSector = (sector + 1) % 8;
float sectorFraction = fract(sectorPosition);
float localAmplitude = uBands[sector];
float sectorEdgeBlend = 0.025;
if (sectorFraction < sectorEdgeBlend) {
  localAmplitude = mix(
    uBands[previousSector],
    localAmplitude,
    smoothstep(0.0, sectorEdgeBlend, sectorFraction)
  );
} else if (sectorFraction > 1.0 - sectorEdgeBlend) {
  localAmplitude = mix(
    localAmplitude,
    uBands[nextSector],
    smoothstep(1.0 - sectorEdgeBlend, 1.0, sectorFraction)
  );
}
float poleWeight = pow(abs(direction.y), uPoleBlend) * uPoleInfluence;
float seamDistance = min(angle, 1.0 - angle) * 360.0;
float seamWeight = (1.0 - smoothstep(0.0, uSeamWidth, seamDistance)) * uSeamInfluence;
float globalWeight = max(poleWeight, seamWeight);
float amplitude = mix(localAmplitude, uGlobalAmplitude, globalWeight);
// CAMBIAR noiseScale/noiseSpeed controla el tamano y movimiento del ruido procedural.
float noise = cnoise(direction * uNoiseScale + vec3(0.0, uTime * uNoiseSpeed, 0.0));
// Esta formula combina el relieve cnoise con la intensidad FFT: aqui se forma la animacion.
float displacement = noise * uNoiseAmount
  + amplitude * uAudioDeformation * (1.0 + noise * uNoiseInfluence);
transformed += direction * displacement;`,
  );
};
sphereMaterial.customProgramCacheKey = () => "audio-classic-noise-eight-sectors";

const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
sphere.scale.setScalar(VISUAL.sphereSize);
sphere.position.y = 0.9;
scene.add(sphere);
// Se agrega despues de la escena: el bloom se aplica al resultado final renderizado.
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  VISUAL.bloomStrength,
  VISUAL.bloomRadius,
  VISUAL.bloomThreshold,
);
composer.addPass(bloomPass);

const floorMaterial = new THREE.MeshStandardMaterial({
  color: VISUAL.floorColor,
  roughness: 0.85,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMaterial);
floor.scale.setScalar(VISUAL.floorSize);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.02;
scene.add(floor);

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
    sphereGeometry = nextGeometry;
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
