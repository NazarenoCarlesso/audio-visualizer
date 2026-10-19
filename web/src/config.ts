// AJUSTES RAPIDOS: cambia estos valores para personalizar la escena.
export const VISUAL = {
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
  sectorEdgeBlend: 0.66, // Suavizado en bordes entre sectores (0 = borde duro, 1 = muy suave).
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

export const SAMPLE_RATE = 48_000;
export const FFT_SIZE = 2_048;
export const FFT_BANDS = 64;
export const NYQUIST_HZ = SAMPLE_RATE / 2;
export const MIN_CROSSOVER_GAP_HZ = 1;

export const EQ_BAND_DEFINITIONS = [
  { key: "subBass", label: "Subgraves", crossoverKey: "subBass" },
  { key: "bass", label: "Graves", crossoverKey: "bass" },
  { key: "lowMids", label: "Medios graves", crossoverKey: "lowMids" },
  { key: "mids", label: "Medios", crossoverKey: "mids" },
  { key: "upperMids", label: "Medios altos", crossoverKey: "upperMids" },
  { key: "presence", label: "Presencia", crossoverKey: "presence" },
  { key: "brilliance", label: "Brillo", crossoverKey: "brilliance" },
  { key: "air", label: "Aire" },
] as const;

export type EqualizerBandKey = typeof EQ_BAND_DEFINITIONS[number]["key"];
export type CrossoverKey = Exclude<EqualizerBandKey, "air">;

export const FREQUENCY = {
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

export const getEqualizerRanges = () => {
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

export const FFT_BAND_CENTER_HZ = Array.from({ length: FFT_BANDS }, (_, band) => {
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

export const getFftBandsByEqualizerRange = () =>
  getEqualizerRanges().map((range) =>
    FFT_BAND_CENTER_HZ.flatMap((centerHz, index) =>
      centerHz >= range.minHz && centerHz < range.maxHz ? [index] : [],
    ),
  );
