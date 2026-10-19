import * as THREE from "three";
import {
  VISUAL,
  FREQUENCY,
  NYQUIST_HZ,
  FFT_BAND_CENTER_HZ,
  getEqualizerRanges,
  type EqualizerBandKey,
} from "./config";

const chartCanvas = document.createElement("canvas");
chartCanvas.width = 960;
chartCanvas.height = 588;
chartCanvas.style.cssText = "display:block;width:100%;height:auto;aspect-ratio:18/11";

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

export const chartPanel = document.createElement("div");
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
chartPanel.append(chartHeader, chartCanvas);

export const drawEqSpectrumChart = (spectrum: Float32Array) => {
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
