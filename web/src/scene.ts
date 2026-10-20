import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { VISUAL } from "./config";
import { sphere } from "./sphere";

export const scene = new THREE.Scene();

scene.background = new THREE.Color(VISUAL.backgroundColor);

export const camera = new THREE.PerspectiveCamera(
  120,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);

camera.position.set(0, 2.6, 6);
camera.lookAt(0, 0.8, 0);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

scene.add(new THREE.HemisphereLight(0xc8e3ff, 0x182033, 2));
const keyLight = new THREE.DirectionalLight(0xffffff, 3);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

scene.add(sphere);

// Se agrega despues de la escena: el bloom se aplica al resultado final renderizado.
export const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  VISUAL.bloomStrength,
  VISUAL.bloomRadius,
  VISUAL.bloomThreshold,
);
composer.addPass(bloomPass);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});