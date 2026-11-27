import * as THREE from "three";
import {
  VISUAL,
  FFT_BANDS,
  EQ_BAND_DEFINITIONS,
  fftBandsByEqualizerRange,
  FREQUENCY,
} from "./config";
import { bands } from "./websocket";

const smoothedBands = new Float32Array(EQ_BAND_DEFINITIONS.length);
const smoothedSpectrumBands = new Float32Array(FFT_BANDS);

export const processAudioFrame = (delta: number) => {
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
    const gain = FREQUENCY.equalizer[groupDefinition.key];
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

  return { smoothedBands, globalAmplitude, smoothedSpectrumBands };
};
