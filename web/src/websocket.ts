import { FFT_BANDS } from "./config";

export let bands = new Float32Array(FFT_BANDS);

export const isTauri = "__TAURI_INTERNALS__" in window;

const isLocalhost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const WS_URL = "ws://127.0.0.1:9001";
const RECONNECT_DELAY_MS = 1000;

function connectWebSocket() {
  const socket = new WebSocket(WS_URL);

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

  socket.addEventListener("close", () => {
    setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
  });

  socket.addEventListener("error", () => {
    socket.close();
  });
}

// Solo conectar al backend Rust local cuando corre en Tauri o en desarrollo local.
if (isTauri || isLocalhost) {
  connectWebSocket();
}
