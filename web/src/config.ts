export async function loadConfig(
  spherePreset = "default",
  equalizerPreset = "default",
) {
  try {
    const [sphereRes, equalizerRes] = await Promise.all([
      fetch(`/sphere/${spherePreset}.json`),
      fetch(`/equalizer/${equalizerPreset}.json`),
    ]);

    if (sphereRes.ok) {
      const sphereData = await sphereRes.json();
      Object.assign(VISUAL, sphereData);
    }

    if (equalizerRes.ok) {
      const eqData = await equalizerRes.json();
      if (typeof eqData.floorHz === "number") {
        FREQUENCY.floorHz = eqData.floorHz;
      }
      if (typeof eqData.ceilingHz === "number") {
        FREQUENCY.ceilingHz = eqData.ceilingHz;
      }
      if (eqData.crossovers && typeof eqData.crossovers === "object") {
        Object.assign(FREQUENCY.crossovers, eqData.crossovers);
      }
      if (eqData.equalizer && typeof eqData.equalizer === "object") {
        Object.assign(FREQUENCY.equalizer, eqData.equalizer);
      }
    }
  } catch (error) {
    console.error("Error al cargar la configuración.", error);
  }
}

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
  colorHueStart: 0.54, // Color inicial; el tono HSL va de 0 a 1.
  colorHueRange: 0, // Cuanto cambia el tono alrededor de la esfera.
  colorSaturation: 1, // Intensidad del color (0 = gris, 1 = intenso).
  colorLightness: 0.55, // Luminosidad; debe ser alta para que el bloom ilumine la malla.
  bloomStrength: 1.2, // Intensidad del halo.
  bloomRadius: 0.1, // Tamano y suavidad del halo.
  bloomThreshold: 0.1, // Brillo minimo de los pixeles que generan bloom.
  sectorEdgeBlend: 0.66, // Suavizado en bordes entre sectores (0 = borde duro, 1 = muy suave).
  attackSpeed: 24, // Rapidez con la que la malla responde al sonido.
  releaseSpeed: 12, // Rapidez con la que vuelve a su forma base.
  rotationSpeed: 0.2, // Velocidad de rotacion.
  // Giro inicial en grados sobre el eje Y, igual que la rotacion continua.
  rotationOffset: 0
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
  floorHz: 30,
  ceilingHz: 16_000,
  crossovers: {
    subBass: 60,
    bass: 150,
    lowMids: 250,
    mids: 500,
    upperMids: 1_000,
    presence: 2_000,
    brilliance: 4_000,
  } satisfies Record<CrossoverKey, number>,
  equalizer: {
    subBass: 1,
    bass: 1,
    lowMids: 1,
    mids: 1,
    upperMids: 1,
    presence: 1,
    brilliance: 1,
    air: 1,
  }
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

export let fftBandsByEqualizerRange = getFftBandsByEqualizerRange();

export const refreshFftBands = () => {
  fftBandsByEqualizerRange = getFftBandsByEqualizerRange();
};
