import { EQ_BAND_DEFINITIONS, FFT_BANDS } from "./config";

export let bands = new Float32Array(FFT_BANDS);

export const smoothedBands = new Float32Array(EQ_BAND_DEFINITIONS.length);

export const smoothedSpectrumBands = new Float32Array(FFT_BANDS);

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