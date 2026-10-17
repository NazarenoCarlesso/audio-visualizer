use std::{
    collections::VecDeque,
    thread,
    time::Duration,
};

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait};
use futures_util::SinkExt;
use realfft::RealFftPlanner;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{oneshot, watch},
};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use wasapi::{
    initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
};

const FFT_SIZE: usize = 2048;
const CHANNELS: usize = 2;
const BANDS: usize = 64;
const SAMPLE_RATE: usize = 48_000;

#[tokio::main]
async fn main() -> Result<()> {
    let output = cpal::default_host()
        .default_output_device()
        .context("No hay un dispositivo de salida predeterminado")?;
    eprintln!("Salida predeterminada: {}", output.name()?);

    let (frequency_tx, frequency_rx) = watch::channel(vec![0.0; BANDS]);
    let (ready_tx, ready_rx) = oneshot::channel();
    thread::Builder::new()
        .name("wasapi-loopback-fft".into())
        .spawn(move || capture_loop(frequency_tx, ready_tx))
        .context("No se pudo iniciar el hilo de captura")?;
    ready_rx
        .await
        .context("El hilo de captura terminó durante el arranque")??;

    let listener = TcpListener::bind("127.0.0.1:9001")
        .await
        .context("No se pudo abrir el WebSocket en 127.0.0.1:9001")?;
    println!("FFT disponible en ws://127.0.0.1:9001");

    loop {
        let (stream, _) = listener.accept().await?;
        tokio::spawn(serve_client(stream, frequency_rx.clone()));
    }
}

fn capture_loop(
    frequencies: watch::Sender<Vec<f32>>,
    ready: oneshot::Sender<Result<()>>,
) {
    let result = capture(frequencies, ready);
    if let Err(error) = result {
        eprintln!("Error de captura WASAPI: {error:#}");
    }
}

fn capture(
    frequencies: watch::Sender<Vec<f32>>,
    ready: oneshot::Sender<Result<()>>,
) -> Result<()> {
    initialize_mta().ok().context("No se pudo inicializar COM")?;

    let enumerator = DeviceEnumerator::new().context("No se pudo crear WASAPI enumerator")?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .context("No se encontró la salida WASAPI predeterminada")?;
    let mut audio_client = device
        .get_iaudioclient()
        .context("No se pudo abrir el cliente WASAPI")?;

    let format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        SAMPLE_RATE,
        CHANNELS,
        None,
    );
    let (_, min_period) = audio_client
        .get_device_period()
        .context("No se pudo consultar el periodo del dispositivo")?;
    let mode = StreamMode::PollingShared {
        autoconvert: true,
        buffer_duration_hns: min_period,
    };
    audio_client
        .initialize_client(&format, &Direction::Capture, &mode)
        .context("No se pudo inicializar la captura WASAPI loopback")?;
    let capture_client = audio_client
        .get_audiocaptureclient()
        .context("No se pudo obtener el cliente de captura")?;
    audio_client
        .start_stream()
        .context("No se pudo iniciar WASAPI loopback")?;

    ready
        .send(Ok(()))
        .map_err(|_| anyhow::anyhow!("El proceso principal terminó antes de iniciar la captura"))?;
    println!("Capturando loopback WASAPI ({SAMPLE_RATE} Hz)");

    let mut byte_queue = VecDeque::with_capacity(FFT_SIZE * CHANNELS * 4 * 4);
    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let mut input = vec![0.0; FFT_SIZE];
    let mut spectrum = fft.make_output_vec();
    let mut scratch = fft.make_scratch_vec();
    let window: Vec<f32> = (0..FFT_SIZE)
        .map(|i| {
            0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / (FFT_SIZE - 1) as f32).cos()
        })
        .collect();
    let frame_bytes = FFT_SIZE * CHANNELS * std::mem::size_of::<f32>();

    loop {
        if audio_client
            .get_current_padding()
            .context("No se pudo consultar el buffer de captura WASAPI")?
            > 0
        {
            capture_client
                .read_from_device_to_deque(&mut byte_queue)
                .context("Error leyendo muestras WASAPI")?;
        }

        while byte_queue.len() >= frame_bytes {
            for sample in &mut input {
                let left = take_f32(&mut byte_queue);
                let right = take_f32(&mut byte_queue);
                *sample = (left + right) * 0.5;
            }

            for (sample, weight) in input.iter_mut().zip(&window) {
                *sample *= weight;
            }
            fft.process_with_scratch(&mut input, &mut spectrum, &mut scratch)
                .context("Error calculando FFT")?;

            let max_bin = FFT_SIZE / 2;
            let mut bands = vec![0.0; BANDS];
            for (band, output) in bands.iter_mut().enumerate() {
                let start = (max_bin as f32)
                    .powf(band as f32 / BANDS as f32)
                    .floor() as usize;
                let end = (max_bin as f32)
                    .powf((band + 1) as f32 / BANDS as f32)
                    .ceil() as usize;
                let start = start.clamp(1, max_bin);
                let end = end.clamp(start + 1, max_bin + 1);
                let average_magnitude = spectrum[start..end]
                    .iter()
                    .map(|value| value.norm())
                    .sum::<f32>()
                    / (end - start) as f32;
                *output = (average_magnitude * 16.0 / FFT_SIZE as f32).min(1.0);
            }
            frequencies.send_replace(bands);
        }

        thread::sleep(Duration::from_millis(5));
    }
}

fn take_f32(bytes: &mut VecDeque<u8>) -> f32 {
    let sample = [
        bytes.pop_front().expect("se validó el tamaño del bloque"),
        bytes.pop_front().expect("se validó el tamaño del bloque"),
        bytes.pop_front().expect("se validó el tamaño del bloque"),
        bytes.pop_front().expect("se validó el tamaño del bloque"),
    ];
    f32::from_le_bytes(sample)
}

async fn serve_client(stream: TcpStream, frequencies: watch::Receiver<Vec<f32>>) {
    if let Err(error) = send_frequencies(stream, frequencies).await {
        eprintln!("Cliente WebSocket desconectado: {error}");
    }
}

async fn send_frequencies(
    stream: TcpStream,
    mut frequencies: watch::Receiver<Vec<f32>>,
) -> Result<()> {
    let mut socket = accept_async(stream)
        .await
        .context("No se pudo aceptar conexión WebSocket")?;

    loop {
        frequencies.changed().await.context("La fuente FFT se cerró")?;
        let message = serde_json::to_string(&*frequencies.borrow())?;
        socket
            .send(Message::Text(message.into()))
            .await
            .context("No se pudieron enviar bandas FFT")?;
    }
}
