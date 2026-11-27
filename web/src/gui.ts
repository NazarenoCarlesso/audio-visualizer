import * as THREE from "three";
import {
  CrossoverKey,
  EQ_BAND_DEFINITIONS,
  FREQUENCY,
  getEqualizerRanges,
  MIN_CROSSOVER_GAP_HZ,
  NYQUIST_HZ,
  refreshFftBands,
  VISUAL,
} from "./config";
import { bloomPass } from "./scene";
import { audioUniforms, sphere, sphereMaterial, updateSphereColors } from "./sphere";
import { refreshEqualizerOverlay, setOnEqualizerChange } from "./equalizerChart";

const CHEVRON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`;

interface SliderHandle {
  setMin: (min: number) => void;
  setMax: (max: number) => void;
  setLabel: (label: string) => void;
  updateDisplay: () => void;
}

const allControllers: Array<{ updateDisplay: () => void }> = [];

const formatValue = (value: number, step: number) => {
  if (step >= 1) return String(Math.round(value));
  const decimals = Math.min(3, String(step).split(".")[1]?.length ?? 2);
  return Number(value.toFixed(decimals)).toString();
};

const panel = document.createElement("aside");
panel.className = "settings-panel";

const panelHeader = document.createElement("span");
panelHeader.className = "settings-panel-header";
panelHeader.textContent = "Ajustes del visualizador";

const panelBody = document.createElement("div");
panelBody.className = "settings-body";

panel.append(panelHeader, panelBody);
document.body.appendChild(panel);

const createSection = (title: string, collapsed = true) => {
  const section = document.createElement("section");
  section.className = collapsed ? "settings-section is-collapsed" : "settings-section";

  const header = document.createElement("button");
  header.type = "button";
  header.className = "settings-section-header";
  header.innerHTML = `<span>${title}</span>${CHEVRON_SVG}`;
  header.addEventListener("click", () => {
    section.classList.toggle("is-collapsed");
  });

  const body = document.createElement("div");
  body.className = "settings-section-body";

  section.append(header, body);
  panelBody.appendChild(section);
  return body;
};

const addSlider = <K extends string, T extends Record<K, number>>(
  container: HTMLElement,
  target: T,
  key: K,
  labelText: string,
  min: number,
  max: number,
  step: number,
  options?: {
    onChange?: (value: number) => void;
    onFinishChange?: (value: number) => void;
  },
): SliderHandle => {
  const wrapper = document.createElement("div");
  wrapper.className = "setting-control";

  const header = document.createElement("div");
  header.className = "setting-header";

  const label = document.createElement("span");
  label.className = "setting-label";
  label.textContent = labelText;

  const valueEl = document.createElement("span");
  valueEl.className = "setting-value";

  const input = document.createElement("input");
  input.type = "range";
  input.className = "setting-slider";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);

  const updateDisplay = () => {
    const currentMin = Number(input.min);
    const currentMax = Number(input.max);
    const value = target[key];
    input.value = String(value);
    valueEl.textContent = formatValue(value, step);
    const ratio = currentMax > currentMin
      ? Math.max(0, Math.min(1, (value - currentMin) / (currentMax - currentMin)))
      : 0;
    input.style.setProperty("--percent", `${ratio * 100}%`);
  };

  input.addEventListener("input", () => {
    const value = Number(input.value);
    target[key] = value as T[typeof key];
    updateDisplay();
    options?.onChange?.(value);
  });

  input.addEventListener("change", () => {
    const value = Number(input.value);
    options?.onFinishChange?.(value);
  });

  header.append(label, valueEl);
  wrapper.append(header, input);
  container.appendChild(wrapper);

  updateDisplay();

  const handle: SliderHandle = {
    setMin: (nextMin: number) => {
      input.min = String(nextMin);
    },
    setMax: (nextMax: number) => {
      input.max = String(nextMax);
    },
    setLabel: (nextLabel: string) => {
      label.textContent = nextLabel;
    },
    updateDisplay,
  };
  allControllers.push(handle);
  return handle;
};

// --- Esfera ---
let currentDetail = VISUAL.detail;
const rebuildSphereGeometry = (detail: number) => {
  const nextGeometry = new THREE.IcosahedronGeometry(1, detail);
  updateSphereColors(nextGeometry);
  sphere.geometry.dispose();
  sphere.geometry = nextGeometry;
  currentDetail = detail;
};

const sphereSection = createSection("Esfera");
addSlider(sphereSection, VISUAL, "sphereSize", "Tamaño", 0.5, 8, 0.1, {
  onChange: (size) => sphere.scale.setScalar(size),
});
addSlider(sphereSection, VISUAL, "detail", "Detalle", 1, 30, 1, {
  onFinishChange: (detail) => rebuildSphereGeometry(detail),
});
addSlider(sphereSection, VISUAL, "wireOpacity", "Opacidad", 0, 1, 0.01, {
  onChange: (opacity) => {
    sphereMaterial.opacity = opacity;
  },
});
addSlider(sphereSection, VISUAL, "colorHueStart", "Tono inicial", 0, 1, 0.01, {
  onChange: () => updateSphereColors(sphere.geometry),
});
addSlider(sphereSection, VISUAL, "colorHueRange", "Rango de tono", -1, 1, 0.01, {
  onChange: () => updateSphereColors(sphere.geometry),
});
addSlider(sphereSection, VISUAL, "colorSaturation", "Saturación", 0, 1, 0.01, {
  onChange: () => updateSphereColors(sphere.geometry),
});
addSlider(sphereSection, VISUAL, "colorLightness", "Luminosidad", 0, 1, 0.01, {
  onChange: () => updateSphereColors(sphere.geometry),
});

// --- Audio y deformación ---
const audioSection = createSection("Audio y deformación");
addSlider(audioSection, VISUAL, "audioDeformation", "Fuerza de audio", 0, 5, 0.01, {
  onChange: (value) => {
    audioUniforms.uAudioDeformation.value = value;
  },
});
addSlider(audioSection, VISUAL, "noiseScale", "Escala del ruido", 0.1, 10, 0.1, {
  onChange: (value) => {
    audioUniforms.uNoiseScale.value = value;
  },
});
addSlider(audioSection, VISUAL, "noiseSpeed", "Velocidad del ruido", 0, 3, 0.01, {
  onChange: (value) => {
    audioUniforms.uNoiseSpeed.value = value;
  },
});
addSlider(audioSection, VISUAL, "noiseInfluence", "Influencia del ruido", 0, 2, 0.01, {
  onChange: (value) => {
    audioUniforms.uNoiseInfluence.value = value;
  },
});
addSlider(audioSection, VISUAL, "noiseAmount", "Relieve sin audio", 0, 1, 0.01, {
  onChange: (value) => {
    audioUniforms.uNoiseAmount.value = value;
  },
});
addSlider(audioSection, VISUAL, "sectorEdgeBlend", "Suavizado bordes sector", 0, 1, 0.001, {
  onChange: (value) => {
    audioUniforms.uSectorEdgeBlend.value = value;
  },
});

// --- Polos y volumen global ---
const poleSection = createSection("Polos y volumen global");
addSlider(poleSection, VISUAL, "poleInfluence", "Influencia en polos", 0, 1, 0.01, {
  onChange: (value) => {
    audioUniforms.uPoleInfluence.value = value;
  },
});
addSlider(poleSection, VISUAL, "poleBlend", "Concentración en polos", 0.25, 8, 0.05, {
  onChange: (value) => {
    audioUniforms.uPoleBlend.value = value;
  },
});
addSlider(poleSection, VISUAL, "seamInfluence", "Influencia en costura", 0, 1, 0.01, {
  onChange: (value) => {
    audioUniforms.uSeamInfluence.value = value;
  },
});
addSlider(poleSection, VISUAL, "seamWidth", "Ancho costura (grados)", 1, 90, 1, {
  onChange: (value) => {
    audioUniforms.uSeamWidth.value = value;
  },
});
addSlider(poleSection, VISUAL, "globalScaleByAudio", "Escala global por audio", 0, 2, 0.01);

// --- Ecualizador visual ---
const equalizerSection = createSection("Ecualizador visual");
const equalizerControllers = EQ_BAND_DEFINITIONS.map((band) => ({
  band,
  controller: addSlider(equalizerSection, FREQUENCY.equalizer, band.key, band.label, 0, 8, 0.1, {
    onChange: () => refreshEqualizerOverlay(),
  }),
}));

// --- Rango de frecuencias ---
const frequencySection = createSection("Rango de frecuencias");
const floorController = addSlider(frequencySection, FREQUENCY, "floorHz", "Piso (Hz)", 20, NYQUIST_HZ, 1, {
  onChange: () => refreshFrequencyControls(),
});
const ceilingController = addSlider(frequencySection, FREQUENCY, "ceilingHz", "Techo (Hz)", 20, NYQUIST_HZ, 1, {
  onChange: () => refreshFrequencyControls(),
});
const crossoverControllers = EQ_BAND_DEFINITIONS.slice(0, -1).map((band) => {
  const key = band.key as CrossoverKey;
  const controller = addSlider(
    frequencySection,
    FREQUENCY.crossovers,
    key,
    `${band.label} hasta (Hz)`,
    20,
    NYQUIST_HZ,
    1,
    { onChange: () => refreshFrequencyControls() },
  );
  return { key, label: band.label, controller };
});

function refreshFrequencyControls() {
  const crossoverValues = crossoverControllers.map(({ key }) => FREQUENCY.crossovers[key]);
  floorController.setMin(20);
  floorController.setMax(crossoverValues[0] - MIN_CROSSOVER_GAP_HZ);
  ceilingController.setMin(crossoverValues[crossoverValues.length - 1] + MIN_CROSSOVER_GAP_HZ);
  ceilingController.setMax(NYQUIST_HZ);
  floorController.updateDisplay();
  ceilingController.updateDisplay();

  crossoverControllers.forEach(({ label, controller }, index) => {
    const previousHz = index === 0 ? FREQUENCY.floorHz : crossoverValues[index - 1];
    const nextHz = index === crossoverValues.length - 1
      ? FREQUENCY.ceilingHz
      : crossoverValues[index + 1];
    controller.setMin(previousHz + MIN_CROSSOVER_GAP_HZ);
    controller.setMax(nextHz - MIN_CROSSOVER_GAP_HZ);
    controller.setLabel(`${label} hasta (Hz)`);
    controller.updateDisplay();
  });

  const ranges = getEqualizerRanges();
  equalizerControllers.forEach(({ band, controller }, index) => {
    controller.setLabel(`${band.label} (${Math.round(ranges[index].minHz)}-${Math.round(ranges[index].maxHz)} Hz)`);
  });

  refreshFftBands();
  refreshEqualizerOverlay();
}
refreshFrequencyControls();

setOnEqualizerChange(() => {
  refreshFrequencyControls();
  for (const { controller } of equalizerControllers) {
    controller.updateDisplay();
  }
});

// --- Respuesta ---
const responseSection = createSection("Respuesta");
addSlider(responseSection, VISUAL, "attackSpeed", "Ataque", 1, 60, 1);
addSlider(responseSection, VISUAL, "releaseSpeed", "Relajación", 1, 40, 1);

// --- Rotación ---
const rotationSection = createSection("Rotación");
addSlider(rotationSection, VISUAL, "rotationOffset", "Offset (grados)", -180, 180, 1);
addSlider(rotationSection, VISUAL, "rotationSpeed", "Velocidad", -2, 2, 0.01);

// --- Bloom ---
const bloomSection = createSection("Bloom");
addSlider(bloomSection, VISUAL, "bloomStrength", "Intensidad", 0, 3, 0.01, {
  onChange: (value) => {
    bloomPass.strength = value;
  },
});
addSlider(bloomSection, VISUAL, "bloomRadius", "Radio", 0, 1, 0.01, {
  onChange: (value) => {
    bloomPass.radius = value;
  },
});
addSlider(bloomSection, VISUAL, "bloomThreshold", "Umbral", 0, 1, 0.01, {
  onChange: (value) => {
    bloomPass.threshold = value;
  },
});

export function syncGuiAndSceneFromConfig() {
  sphere.scale.setScalar(VISUAL.sphereSize);
  if (VISUAL.detail !== currentDetail) {
    rebuildSphereGeometry(VISUAL.detail);
  } else {
    updateSphereColors(sphere.geometry);
  }
  sphereMaterial.opacity = VISUAL.wireOpacity;

  audioUniforms.uAudioDeformation.value = VISUAL.audioDeformation;
  audioUniforms.uPoleInfluence.value = VISUAL.poleInfluence;
  audioUniforms.uPoleBlend.value = VISUAL.poleBlend;
  audioUniforms.uSeamInfluence.value = VISUAL.seamInfluence;
  audioUniforms.uSeamWidth.value = VISUAL.seamWidth;
  audioUniforms.uNoiseScale.value = VISUAL.noiseScale;
  audioUniforms.uNoiseSpeed.value = VISUAL.noiseSpeed;
  audioUniforms.uNoiseInfluence.value = VISUAL.noiseInfluence;
  audioUniforms.uNoiseAmount.value = VISUAL.noiseAmount;
  audioUniforms.uSectorEdgeBlend.value = VISUAL.sectorEdgeBlend;

  bloomPass.strength = VISUAL.bloomStrength;
  bloomPass.radius = VISUAL.bloomRadius;
  bloomPass.threshold = VISUAL.bloomThreshold;

  refreshFrequencyControls();
  for (const controller of allControllers) {
    controller.updateDisplay();
  }
}
