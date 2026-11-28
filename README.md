# Visualizador de audio 3D

Aplicación de escritorio para Windows (construida con **Rust + Tauri v2 + Three.js**): un proceso nativo en Rust captura el audio del dispositivo de salida predeterminado mediante WASAPI loopback, normaliza automáticamente su nivel, calcula una FFT de 2048 muestras con 50 % de solapamiento (salto de 1024 muestras, aproximadamente 46,9 análisis/s a 48 kHz) y publica 64 bandas por WebSocket local (`ws://127.0.0.1:9001`). El solapamiento aumenta la frecuencia de actualización sin reducir la resolución frecuencial, que sigue siendo de unos 23,4 Hz por bin. El frontend TypeScript recibe esas bandas y anima una esfera con Three.js; la ecualización visual se configura y aplica únicamente en el frontend.

## Estructura

```text
audio-visualizer/
├── .gitignore
├── Cargo.lock
├── Cargo.toml
├── README.md
├── build.rs
├── package.json
├── tauri.conf.json
├── capabilities/
│   └── default.json
├── icons/
├── src/
│   └── main.rs
└── web/
    ├── index.html
    ├── package-lock.json
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.js
    └── src/
        └── main.ts
```

## Por qué el audio no se procesa en WASM

Un módulo WASM ejecutado por una página web no puede abrir directamente el dispositivo de salida del sistema ni usar WASAPI. Además, `cpal` no ofrece una API pública para capturar WASAPI loopback. Por eso el proyecto usa `cpal` para consultar el dispositivo de salida predeterminado y el crate `wasapi` para capturarlo realmente en un proceso nativo de Rust. La FFT se calcula en Rust y sus resultados llegan a la interfaz por WebSocket local. Esta arquitectura permite capturar el audio del sistema sin micrófono ni archivos, y al mismo tiempo mantener `web/` desacoplado para poder desplegarlo de forma independiente (por ejemplo en Vercel).

La escena usa el renderizador WebGL predeterminado de Three.js para mantener pequeño el setup.

## Requisitos

- Windows 10/11 con un dispositivo de salida de audio predeterminado (WebView2 incluido en Windows 10/11).
- Rust 1.85 o posterior y Cargo: <https://rustup.rs/>
- Node.js LTS y npm: <https://nodejs.org/>

## Instalación de dependencias

Desde la raíz del proyecto:

```powershell
npm install
npm --prefix web install
```

## Ejecutar

### 1. App de escritorio nativa (Tauri) — Recomendado

Desde la raíz del proyecto, en una sola terminal:

```powershell
npm run dev
```

Esto levanta Vite, compila el backend en Rust y abre la ventana nativa automáticamente. Reproduce audio en el equipo: la esfera se deformará según las frecuencias capturadas sin solicitar acceso al micrófono.

### 2. Compilar ejecutable e instalador (`.exe`)

```powershell
npm run build
```

Al terminar, los binarios generados quedan en:

- Ejecutable directo: `target\release\audio-visualizer.exe`
- Instaladores (MSI / NSIS): `target\release\bundle\`

### 3. Solo frontend web (desarrollo o despliegue en Vercel)

El frontend en `web/` es una aplicación Vite independiente:

```powershell
cd web
npm run dev
```

Abre la URL local que muestre Vite (normalmente <http://localhost:5173>). Sin el backend de Rust corriendo, la escena 3D y los controles funcionan normalmente, pero la esfera no recibirá señal de audio del sistema. Para desplegar en **Vercel**, configura el **Root Directory** como `web`.

## Controles en tiempo real

El panel lil-gui aparece en la esquina superior derecha. Permite ajustar en vivo la escena, la esfera, los colores, la deformación y el ruido, las ocho bandas del ecualizador visual, el rango de frecuencias, la respuesta, la rotación, el piso y el bloom. Cada grupo del ecualizador controla uno de ocho sectores angulares iguales de la esfera. En **Rango de frecuencias**, el piso, el techo y los siete cruces se editan en Hz; los cruces se mantienen ordenados y limitados por sus vecinos. Las frecuencias fuera del piso y el techo no alimentan la esfera ni su nivel global; en el gráfico se sombrean y sus barras se atenúan. Como Rust transmite 64 bandas FFT agrupadas, cada banda se asigna a un grupo por su frecuencia central: los cruces son configurables, pero la precisión efectiva está limitada por la resolución de esas 64 bandas. En el gráfico, el eje horizontal usa frecuencia logarítmica, la curva tiene escala de ganancia 0-8x y las barras escala de nivel 0-1. En **Polos y volumen global**, `Influencia en polos` mezcla el nivel global RMS con la frecuencia local según la distancia al polo, y `Concentración en polos` define cuán cerca de los polos ocurre esa mezcla. `Influencia en costura` y `Ancho costura (grados)` suavizan la transición entre el último sector y el primero donde se cierra el mapeo angular. `Escala global por audio` aumenta el tamaño base de toda la esfera según ese mismo nivel global; empieza en `0`, por lo que está desactivado. El offset de rotación es un solo ángulo en grados alrededor del eje Y, el mismo eje de la rotación continua. Los cambios se aplican sin recargar la página; el ecualizador afecta solo la visualización y no cambia el audio del sistema.

El backend aplica una ganancia automática común a las muestras antes de la FFT. Apunta a un RMS de `0.08`, aumenta la ganancia lentamente (hasta `32x`), la reduce más rápido ante señales fuertes y silencia bloques por debajo de RMS `0.0005` para no amplificar ruido en silencio. Esto hace que el nivel visual sea menos dependiente del volumen del sistema, aunque puede levantar pasajes musicales suaves cuando no hay silencio digital.

## Verificación de compilación y tests

```powershell
cargo test
npm --prefix web run build
```
