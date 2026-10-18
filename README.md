# Visualizador de audio 3D (PoC)

PoC mínima para Windows: un proceso Rust captura el audio del dispositivo de salida predeterminado mediante WASAPI loopback, normaliza automáticamente su nivel, calcula una FFT de 2048 muestras con 50 % de solapamiento (salto de 1024 muestras, aproximadamente 46,9 análisis/s a 48 kHz) y publica 64 bandas por WebSocket. El solapamiento aumenta la frecuencia de actualización sin reducir la resolución frecuencial, que sigue siendo de unos 23,4 Hz por bin. El frontend TypeScript recibe esas bandas y anima una esfera sobre un plano con Three.js; la ecualización visual se configura y aplica únicamente en el frontend.

## Estructura

```text
audio-visualizer/
├── .gitignore
├── Cargo.lock
├── Cargo.toml
├── README.md
├── src/
│   └── main.rs
└── web/
    ├── index.html
    ├── package-lock.json
    ├── package.json
    ├── tsconfig.json
    └── src/
        └── main.ts
```

## Por qué el audio no se procesa en WASM

Un módulo WASM ejecutado por una página web no puede abrir directamente el dispositivo de salida del sistema ni usar WASAPI. Además, `cpal` no ofrece una API pública para capturar WASAPI loopback. Por eso esta PoC usa `cpal` para consultar el dispositivo de salida predeterminado y el crate `wasapi` para capturarlo realmente en un proceso nativo de Rust. La FFT se calcula en Rust y sus resultados llegan al navegador por WebSocket. Esta separación es necesaria para cumplir el requisito de capturar el audio del sistema sin micrófono ni archivos.

La escena usa el renderizador WebGL predeterminado de Three.js para mantener pequeño el setup; el requisito permite Three.js como alternativa a WebGPU.

## Requisitos

- Windows 10/11 con un dispositivo de salida de audio predeterminado.
- Rust 1.85 o posterior y Cargo: <https://rustup.rs/>
- Node.js LTS y npm: <https://nodejs.org/>

## Ejecutar

Abre dos terminales en la raíz del proyecto.

**Terminal 1 — captura y FFT:**

```powershell
cargo run
```

El backend queda escuchando WebSocket en `ws://127.0.0.1:9001`.

### Controles en tiempo real

El panel lil-gui aparece en la esquina superior derecha. Permite ajustar en vivo la escena, la esfera, los colores, la deformacion y el ruido, las ocho bandas del ecualizador visual, el rango de frecuencias, la respuesta, la rotacion, el piso y el bloom. Cada grupo del ecualizador controla uno de ocho sectores angulares iguales de la esfera. En **Rango de frecuencias**, el piso, el techo y los siete cruces se editan en Hz; los cruces se mantienen ordenados y limitados por sus vecinos. Las frecuencias fuera del piso y el techo no alimentan la esfera ni su nivel global; en el grafico se sombrean y sus barras se atenúan. Como Rust transmite 64 bandas FFT agrupadas, cada banda se asigna a un grupo por su frecuencia central: los cruces son configurables, pero la precision efectiva esta limitada por la resolucion de esas 64 bandas. En el grafico, el eje horizontal usa frecuencia logaritmica, la curva tiene escala de ganancia 0-8x y las barras escala de nivel 0-1. En **Polos y volumen global**, `Influencia en polos` mezcla el nivel global RMS con la frecuencia local segun la distancia al polo, y `Concentracion en polos` define cuan cerca de los polos ocurre esa mezcla. `Influencia en costura` y `Ancho costura (grados)` suavizan la transicion entre el ultimo sector y el primero donde se cierra el mapeo angular. `Escala global por audio` aumenta el tamano base de toda la esfera segun ese mismo nivel global; empieza en `0`, por lo que esta desactivado. El offset de rotacion es un solo angulo en grados alrededor del eje Y, el mismo eje de la rotacion continua. Los cambios se aplican sin recargar la pagina; el ecualizador afecta solo la visualizacion y no cambia el audio del sistema.

El backend aplica una ganancia automatica comun a las muestras antes de la FFT. Apunta a un RMS de `0.08`, aumenta la ganancia lentamente (hasta `32x`), la reduce mas rapido ante señales fuertes y silencia bloques por debajo de RMS `0.0005` para no amplificar ruido en silencio. Esto hace que el nivel visual sea menos dependiente del volumen del sistema, aunque puede levantar pasajes musicales suaves cuando no hay silencio digital.

**Terminal 2 — frontend:**

```powershell
cd web
npm install
npm run dev
```

Abre la URL local que muestre Vite (normalmente <http://localhost:5173>). Reproduce audio en el equipo: la esfera se deformará según las frecuencias capturadas. No se solicita acceso al micrófono.

## Verificación de compilación

```powershell
cargo check
cd web
npm run build
```
