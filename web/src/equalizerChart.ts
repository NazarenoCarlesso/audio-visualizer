import * as THREE from "three";
import {
  CrossoverKey,
  EQ_BAND_DEFINITIONS,
  EqualizerBandKey,
  FFT_BAND_CENTER_HZ,
  FREQUENCY,
  getEqualizerRanges,
  MIN_CROSSOVER_GAP_HZ,
  NYQUIST_HZ,
  refreshFftBands,
} from "./config";

const MIN_HZ = 20;
const MAX_HZ = NYQUIST_HZ;
const LOG_MIN = Math.log(MIN_HZ);
const LOG_RANGE = Math.log(MAX_HZ) - LOG_MIN;

const BAND_FILLS = [
  "rgba(120,200,255,.08)",
  "rgba(130,230,225,.06)",
  "rgba(180,240,255,.08)",
  "rgba(150,185,255,.06)",
  "rgba(210,225,255,.08)",
  "rgba(140,210,245,.06)",
  "rgba(170,230,255,.08)",
  "rgba(190,210,255,.06)",
];

const TICKS: ReadonlyArray<readonly [number, string]> = [
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
];

const hzToPercent = (hz: number) =>
  ((Math.log(THREE.MathUtils.clamp(hz, MIN_HZ, MAX_HZ)) - LOG_MIN) / LOG_RANGE) * 100;

const percentToHz = (pct: number) =>
  Math.exp(LOG_MIN + THREE.MathUtils.clamp(pct, 0, 1) * LOG_RANGE);

const formatHz = (hz: number) =>
  hz >= 1000
    ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1).replace(".", ",")} kHz`
    : `${Math.round(hz)} Hz`;

const formatGain = (gain: number) => `${gain.toFixed(1).replace(".", ",")}×`;

let onEqualizerChange: (() => void) | null = null;
export const setOnEqualizerChange = (callback: () => void) => {
  onEqualizerChange = callback;
};

const notifyChange = () => {
  refreshFftBands();
  refreshEqualizerOverlay();
  onEqualizerChange?.();
};

// --- Panel raíz ---
export const chartPanel = document.createElement("aside");
chartPanel.className = "eq-chart-panel is-collapsed";

// --- Cabecera colapsable ---
const topRow = document.createElement("div");
topRow.className = "eq-top-row";

const titleGroup = document.createElement("div");
titleGroup.className = "eq-title-group";

const CHEVRON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`;

const chartHeader = document.createElement("button");
chartHeader.type = "button";
chartHeader.className = "eq-chart-header";
chartHeader.innerHTML = `<span>Ecualizador y espectro</span>${CHEVRON_SVG}`;
chartHeader.setAttribute("aria-expanded", "false");

const subtitle = document.createElement("span");
subtitle.className = "eq-subtitle";
subtitle.textContent =
  "Arrastrá las líneas verticales para definir las bandas y los puntos para ajustar la ganancia.";

titleGroup.append(chartHeader, subtitle);

const actionsRow = document.createElement("div");
actionsRow.className = "eq-actions";

const resetBtn = document.createElement("button");
resetBtn.type = "button";
resetBtn.className = "eq-pill-btn";
resetBtn.textContent = "Restablecer";
resetBtn.addEventListener("click", () => {
  FREQUENCY.floorHz = 30;
  FREQUENCY.ceilingHz = 16_000;
  FREQUENCY.crossovers.subBass = 60;
  FREQUENCY.crossovers.bass = 150;
  FREQUENCY.crossovers.lowMids = 250;
  FREQUENCY.crossovers.mids = 500;
  FREQUENCY.crossovers.upperMids = 1_000;
  FREQUENCY.crossovers.presence = 2_000;
  FREQUENCY.crossovers.brilliance = 4_000;
  for (const band of EQ_BAND_DEFINITIONS) {
    FREQUENCY.equalizer[band.key] = 1;
  }
  notifyChange();
});

actionsRow.append(resetBtn);
topRow.append(titleGroup, actionsRow);

// --- Cuerpo colapsable ---
const eqBody = document.createElement("div");
eqBody.className = "eq-body";

// Leyenda
const legend = document.createElement("div");
legend.className = "eq-legend";
legend.innerHTML = `
  <span><i class="eq-leg-line"></i>Ganancia por banda</span>
  <span><i class="eq-leg-in"></i>Audio de entrada</span>
  <span><i class="eq-leg-out"></i>Salida ecualizada</span>
  <span><i class="eq-leg-div"></i>Límite de banda</span>
`;

// Fila del gráfico con ejes Y
const plotRow = document.createElement("div");
plotRow.className = "eq-plot-row";

const yAxisLeft = document.createElement("div");
yAxisLeft.className = "eq-y-axis eq-y-left";
yAxisLeft.innerHTML = `
  <span style="top:-6px">8×</span>
  <span style="top:25%">6×</span>
  <span style="top:50%">4×</span>
  <span style="top:75%">2×</span>
  <span class="eq-y-highlight" style="bottom:12.5%">1×</span>
  <span style="bottom:-6px">0×</span>
`;

const plotCol = document.createElement("div");
plotCol.className = "eq-plot-col";

const plotBox = document.createElement("div");
plotBox.className = "eq-plot-box";

const chartCanvas = document.createElement("canvas");
chartCanvas.className = "eq-chart-canvas";
chartCanvas.width = 960;
chartCanvas.height = 440;

const overlayLayer = document.createElement("div");
overlayLayer.className = "eq-overlay-layer";

plotBox.append(chartCanvas, overlayLayer);

const xAxis = document.createElement("div");
xAxis.className = "eq-x-axis";
for (const [hz, label] of TICKS) {
  const tick = document.createElement("span");
  tick.style.left = `${hzToPercent(hz)}%`;
  tick.textContent = label;
  xAxis.appendChild(tick);
}

plotCol.append(plotBox, xAxis);

const yAxisRight = document.createElement("div");
yAxisRight.className = "eq-y-axis eq-y-right";
yAxisRight.innerHTML = `
  <span style="top:-6px">1,0</span>
  <span style="top:50%">0,5</span>
  <span style="bottom:-6px">0</span>
`;

plotRow.append(yAxisLeft, plotCol, yAxisRight);

// Tarjetas resumen de bandas
const cardsGrid = document.createElement("div");
cardsGrid.className = "eq-cards-grid";

eqBody.append(legend, plotRow, cardsGrid);
chartPanel.append(topRow, eqBody);

// Toggle colapsar/expandir
chartHeader.addEventListener("click", () => {
  const isCollapsed = chartPanel.classList.toggle("is-collapsed");
  chartHeader.setAttribute("aria-expanded", String(!isCollapsed));
  if (!isCollapsed) {
    refreshEqualizerOverlay();
  }
});

// --- Controles interactivos sobre el gráfico ---
const bandHandles: Array<{
  key: EqualizerBandKey;
  btn: HTMLButtonElement;
  cardGain: HTMLSpanElement;
  cardRange: HTMLSpanElement;
}> = [];

for (const band of EQ_BAND_DEFINITIONS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "eq-gain-hit";
  btn.setAttribute("aria-label", `Ganancia de ${band.label}`);
  btn.innerHTML = `<span class="eq-gain-dot"></span>`;

  btn.addEventListener("pointerdown", (e) => {
    btn.setPointerCapture(e.pointerId);
  });
  btn.addEventListener("pointermove", (e) => {
    if (!btn.hasPointerCapture(e.pointerId)) return;
    const rect = plotBox.getBoundingClientRect();
    let gain = 8 * (1 - (e.clientY - rect.top) / rect.height);
    gain = THREE.MathUtils.clamp(gain, 0, 8);
    if (Math.abs(gain - 1) < 0.12) gain = 1;
    FREQUENCY.equalizer[band.key] = Math.round(gain * 10) / 10;
    notifyChange();
  });

  overlayLayer.appendChild(btn);

  const card = document.createElement("div");
  card.className = "eq-band-card";
  const cardName = document.createElement("span");
  cardName.className = "eq-band-name";
  cardName.textContent = band.label;
  const cardGain = document.createElement("span");
  cardGain.className = "eq-band-gain";
  const cardRange = document.createElement("span");
  cardRange.className = "eq-band-range";
  card.append(cardName, cardGain, cardRange);
  cardsGrid.appendChild(card);

  bandHandles.push({ key: band.key, btn, cardGain, cardRange });
}

// Divisores arrastrables (los 7 crossovers)
const crossoverKeys = EQ_BAND_DEFINITIONS.slice(0, -1).map(
  (b) => b.key as CrossoverKey,
);

const dividerHandles: Array<{
  key: CrossoverKey;
  index: number;
  wrap: HTMLDivElement;
  badge: HTMLSpanElement;
}> = [];

crossoverKeys.forEach((key, index) => {
  const wrap = document.createElement("div");
  wrap.className = "eq-divider-wrap";

  const line = document.createElement("div");
  line.className = "eq-divider-line";

  const hit = document.createElement("button");
  hit.type = "button";
  hit.className = "eq-divider-hit";
  hit.setAttribute("aria-label", `Límite de ${EQ_BAND_DEFINITIONS[index].label}`);

  const badge = document.createElement("span");
  badge.className = "eq-divider-badge";
  hit.appendChild(badge);

  hit.addEventListener("pointerdown", (e) => {
    hit.setPointerCapture(e.pointerId);
  });
  hit.addEventListener("pointermove", (e) => {
    if (!hit.hasPointerCapture(e.pointerId)) return;
    const rect = plotBox.getBoundingClientRect();
    const hz = percentToHz((e.clientX - rect.left) / rect.width);
    const prevHz =
      index === 0 ? FREQUENCY.floorHz : FREQUENCY.crossovers[crossoverKeys[index - 1]];
    const nextHz =
      index === crossoverKeys.length - 1
        ? FREQUENCY.ceilingHz
        : FREQUENCY.crossovers[crossoverKeys[index + 1]];
    const clamped = THREE.MathUtils.clamp(
      Math.round(hz),
      prevHz + MIN_CROSSOVER_GAP_HZ,
      nextHz - MIN_CROSSOVER_GAP_HZ,
    );
    FREQUENCY.crossovers[key] = clamped;
    notifyChange();
  });

  wrap.append(line, hit);
  overlayLayer.appendChild(wrap);
  dividerHandles.push({ key, index, wrap, badge });
});

export const refreshEqualizerOverlay = () => {
  const ranges = getEqualizerRanges();

  ranges.forEach((range, index) => {
    const handle = bandHandles[index];
    const leftPct = hzToPercent(range.minHz);
    const rightPct = hzToPercent(range.maxHz);
    const midPct = (leftPct + rightPct) * 0.5;
    const gain = FREQUENCY.equalizer[range.key as EqualizerBandKey];
    const bottomPct = (THREE.MathUtils.clamp(gain, 0, 8) / 8) * 100;

    handle.btn.style.left = `${midPct}%`;
    handle.btn.style.bottom = `${bottomPct}%`;
    handle.cardGain.textContent = formatGain(gain);
    handle.cardRange.textContent = `${formatHz(range.minHz)} – ${formatHz(range.maxHz)}`;
  });

  dividerHandles.forEach(({ key, wrap, badge }) => {
    const hz = FREQUENCY.crossovers[key];
    wrap.style.left = `${hzToPercent(hz)}%`;
    badge.textContent = formatHz(hz);
  });
};

refreshEqualizerOverlay();

// --- Dibujo en vivo del espectro en el canvas ---
const drawRoundedBar = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  if (h <= 0.5) return;
  const radius = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
};

export const drawEqSpectrumChart = (spectrum: Float32Array) => {
  if (chartPanel.classList.contains("is-collapsed")) return;
  const ctx = chartCanvas.getContext("2d");
  if (!ctx) return;

  const w = chartCanvas.width;
  const h = chartCanvas.height;
  const xForHz = (hz: number) => (hzToPercent(hz) / 100) * w;
  const yForGain = (gain: number) => (1 - THREE.MathUtils.clamp(gain, 0, 8) / 8) * h;

  ctx.clearRect(0, 0, w, h);

  const ranges = getEqualizerRanges();

  // 1. Fondos suaves por banda
  ranges.forEach((range, index) => {
    const x0 = xForHz(range.minHz);
    const x1 = xForHz(range.maxHz);
    ctx.fillStyle = BAND_FILLS[index % BAND_FILLS.length];
    ctx.fillRect(x0, 0, Math.max(0, x1 - x0), h);
  });

  // 2. Zonas fuera de piso/techo
  const floorX = xForHz(FREQUENCY.floorHz);
  const ceilX = xForHz(FREQUENCY.ceilingHz);
  ctx.fillStyle = "rgba(3, 8, 16, 0.55)";
  if (floorX > 0) ctx.fillRect(0, 0, floorX, h);
  if (ceilX < w) ctx.fillRect(ceilX, 0, w - ceilX, h);

  // 3. Líneas horizontales de grilla (6x, 4x, 2x) y línea punteada 1x
  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  ctx.lineWidth = 1;
  for (const frac of [0.25, 0.5, 0.75]) {
    const y = Math.round(h * frac) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
  const y1x = Math.round(yForGain(1)) + 0.5;
  ctx.beginPath();
  ctx.moveTo(0, y1x);
  ctx.lineTo(w, y1x);
  ctx.stroke();
  ctx.restore();

  // 4. Barras de audio de entrada + salida ecualizada
  const outGrad = ctx.createLinearGradient(0, h, 0, 0);
  outGrad.addColorStop(0, "rgba(110, 200, 235, 0.45)");
  outGrad.addColorStop(1, "#cdf6ff");

  for (let band = 0; band < spectrum.length; band += 1) {
    const centerHz = FFT_BAND_CENTER_HZ[band];
    const x = xForHz(centerHz);
    const prevX = band === 0 ? x : xForHz(FFT_BAND_CENTER_HZ[band - 1]);
    const nextX = band === spectrum.length - 1 ? x : xForHz(FFT_BAND_CENTER_HZ[band + 1]);
    const barW = Math.max(4, (nextX - prevX) * 0.68);
    const rawLevel = spectrum[band];
    const isActive = centerHz >= FREQUENCY.floorHz && centerHz < FREQUENCY.ceilingHz;

    const rawH = rawLevel * h;
    ctx.fillStyle = isActive ? "rgba(150, 215, 240, 0.28)" : "rgba(110, 125, 150, 0.18)";
    drawRoundedBar(ctx, x - barW / 2, h - rawH, barW, rawH, 4);

    if (isActive) {
      const range = ranges.find((r) => centerHz >= r.minHz && centerHz < r.maxHz);
      const gain = range ? FREQUENCY.equalizer[range.key as EqualizerBandKey] : 1;
      const eqLevel = Math.min(1, rawLevel * gain);
      const eqH = eqLevel * h;
      ctx.fillStyle = outGrad;
      drawRoundedBar(ctx, x - barW / 2, h - eqH, barW, eqH, 4);
    }
  }

  // 5. Línea de ganancia por banda con brillo
  ctx.save();
  ctx.strokeStyle = "#f2fcff";
  ctx.lineWidth = 3;
  ctx.shadowColor = "rgba(180, 235, 255, 0.85)";
  ctx.shadowBlur = 12;
  for (const range of ranges) {
    const x0 = xForHz(range.minHz);
    const x1 = xForHz(range.maxHz);
    const y = yForGain(FREQUENCY.equalizer[range.key as EqualizerBandKey]);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  ctx.restore();
};
