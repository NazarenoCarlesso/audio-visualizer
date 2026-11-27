import * as THREE from "three";
import classicNoise3D from "./shaders/classicnoise3D.glsl?raw";
import { VISUAL, EQ_BAND_DEFINITIONS } from "./config";

// El shader comparte con Rust las bandas ya suavizadas y calcula el desplazamiento
// en la GPU. `cnoise` aporta variacion organica al relieve del audio.
export const audioUniforms = {
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
  uSectorEdgeBlend: { value: VISUAL.sectorEdgeBlend },
};

export let sphereGeometry = new THREE.IcosahedronGeometry(1, VISUAL.detail);

const vertexColor = new THREE.Color();

export const updateSphereColors = (geometry: THREE.BufferGeometry) => {
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

export const sphereMaterial = new THREE.MeshBasicMaterial({
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
uniform float uNoiseAmount;
uniform float uSectorEdgeBlend;`,
  );

  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `vec3 transformed = vec3(position);
vec3 direction = normalize(position);
// El angulo divide la esfera en ocho sectores iguales, uno por grupo de frecuencias.
float angle = (atan(direction.z, direction.x) + 3.14159265) / 6.2831853;
float sectorPosition = angle * 8.0;
// Desplazamos 0.5 para que floor() cambie en los CENTROS de cada sector,
// no en las fronteras. Asi fract() transiciona de forma continua sin pliegues.
float centeredSectorPos = mod(sectorPosition - 0.5 + 8.0, 8.0);
int sectorA = int(floor(centeredSectorPos)) % 8;
int sectorB = (sectorA + 1) % 8;
float t = fract(centeredSectorPos); // 0 = centro de sectorA, 1 = centro de sectorB
// uSectorEdgeBlend=0 -> borde duro en t=0.5; =1 -> interpolacion maxima suave.
float halfBlend = max(0.0001, uSectorEdgeBlend) * 0.5;
float blendT = smoothstep(0.5 - halfBlend, 0.5 + halfBlend, t);
float localAmplitude = mix(uBands[sectorA], uBands[sectorB], blendT);
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

sphereMaterial.customProgramCacheKey = () => "audio-classic-noise-eight-sectors-v3";

export const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);

sphere.scale.setScalar(VISUAL.sphereSize);

sphere.position.y = 0.9;
