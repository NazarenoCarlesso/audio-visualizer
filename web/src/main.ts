import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import classicNoise3D from "./classicnoise3D.glsl?raw";

// AJUSTES RAPIDOS: cambia estos valores para personalizar la escena.
const VISUAL = {
  backgroundColor: 0x000000, // Fondo de la pagina.
  sphereSize: 4, // Tamano general del icosaedro.
  detail: 30, // Detalle de la malla; bajalo si el equipo va lento.
  wireOpacity: 0.5, // Opacidad de la malla (0 = invisible, 1 = opaca).
  audioDeformation: 0.65, // Fuerza con la que el volumen de audio empuja la superficie.
  noiseScale: 3.0, // Tamano de las formas del ruido: menor = formas mas grandes.
  noiseSpeed: 0.25, // Velocidad a la que el patron de ruido se desplaza.
  noiseInfluence: 0.8, // Cuanto varia el audio entre distintas zonas de la esfera.
  noiseAmount: 0.1, // Relieve sutil aun cuando no hay sonido.
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
  releaseSpeed: 8, // Rapidez con la que vuelve a su forma base.
  rotationSpeed: 0.4, // Velocidad de rotacion.
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

const sphereGeometry = new THREE.IcosahedronGeometry(1, VISUAL.detail);
const basePositions = sphereGeometry.getAttribute("position").array;
const vertexCount = basePositions.length / 3;
const colors = new Float32Array(vertexCount * 3);
const vertexColor = new THREE.Color();
for (let vertex = 0; vertex < vertexCount; vertex += 1) {
  const x = basePositions[vertex * 3];
  const z = basePositions[vertex * 3 + 2];
  // Usa la direccion del punto para repartir el degradado de color alrededor de la malla.
  const angle = (Math.atan2(z, x) + Math.PI) / (Math.PI * 2);
  vertexColor.setHSL(
    VISUAL.colorHueStart + angle * VISUAL.colorHueRange,
    VISUAL.colorSaturation,
    VISUAL.colorLightness,
  );
  vertexColor.toArray(colors, vertex * 3);
}
sphereGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

// El shader comparte con Rust las bandas ya suavizadas y calcula el desplazamiento
// en la GPU. `cnoise` aporta variacion organica al relieve del audio.
const audioUniforms = {
  uTime: { value: 0 },
  uBands: { value: new Float32Array(64) },
  uAudioDeformation: { value: VISUAL.audioDeformation },
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
uniform float uBands[64];
uniform float uAudioDeformation;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uNoiseInfluence;
uniform float uNoiseAmount;`,
  );
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `vec3 transformed = vec3(position);
vec3 direction = normalize(position);
// Esta direccion selecciona que frecuencia controla cada zona de la esfera.
float angle = (atan(direction.z, direction.x) + 3.14159265) / 6.2831853;
float bandPosition = angle * 64.0;
int band = min(int(floor(bandPosition)), 63);
int nextBand = (band + 1) % 64;
float amplitude = mix(uBands[band], uBands[nextBand], fract(bandPosition));
// CAMBIAR noiseScale/noiseSpeed controla el tamano y movimiento del ruido procedural.
float noise = cnoise(direction * uNoiseScale + vec3(0.0, uTime * uNoiseSpeed, 0.0));
// Esta formula combina el relieve cnoise con la intensidad FFT: aqui se forma la animacion.
float displacement = noise * uNoiseAmount
  + amplitude * uAudioDeformation * (1.0 + noise * uNoiseInfluence);
transformed += direction * displacement;`,
  );
};
sphereMaterial.customProgramCacheKey = () => "audio-classic-noise-displacement";

const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
sphere.scale.setScalar(VISUAL.sphereSize);
sphere.position.y = 0.9;
scene.add(sphere);
// Se agrega despues de la escena: el bloom se aplica al resultado final renderizado.
composer.addPass(
  new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    VISUAL.bloomStrength,
    VISUAL.bloomRadius,
    VISUAL.bloomThreshold,
  ),
);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(VISUAL.floorSize, VISUAL.floorSize),
  new THREE.MeshStandardMaterial({ color: VISUAL.floorColor, roughness: 0.85 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.02;
scene.add(floor);

let bands = new Float32Array(64);
const smoothedBands = new Float32Array(64);
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
const animate = () => {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  audioUniforms.uTime.value += delta;

  // Suaviza cada banda para que la malla responda sin saltos bruscos.
  for (let band = 0; band < bands.length; band += 1) {
    const speed = bands[band] > smoothedBands[band]
      ? VISUAL.attackSpeed
      : VISUAL.releaseSpeed;
    const smoothing = 1 - Math.exp(-delta * speed);
    smoothedBands[band] += (bands[band] - smoothedBands[band]) * smoothing;
  }
  audioUniforms.uBands.value.set(smoothedBands);
  sphere.rotation.y += delta * VISUAL.rotationSpeed;
  composer.render();
};
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
