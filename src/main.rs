use std::{collections::VecDeque, thread, time::Duration};

use anyhow::{Context, Result};
use cpal::traits::{DeviceTrait, HostTrait};
use futures_util::SinkExt;
use realfft::{num_complex::Complex, RealFftPlanner};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{oneshot, watch},
};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

const FFT_SIZE: usize = 2048;
const FFT_HOP_SIZE: usize = FFT_SIZE / 2;
const CHANNELS: usize = 2;
const BANDS: usize = 64;
const SAMPLE_RATE: usize = 48_000;
const TARGET_RMS: f32 = 0.08;
const SILENCE_THRESHOLD_RMS: f32 = 0.0005;
const MIN_AUTO_GAIN: f32 = 0.25;
const MAX_AUTO_GAIN: f32 = 32.0;
const GAIN_UP_TIME_SECONDS: f32 = 0.8;
const GAIN_DOWN_TIME_SECONDS: f32 = 0.08;
const SILENCE_RESET_TIME_SECONDS: f32 = 0.25;

struct AutoGain {
    gain: f32,
}

impl Default for AutoGain {
    fn default() -> Self {
        Self { gain: 1.0 }
    }
}

impl AutoGain {
    fn apply(&mut self, samples: &mut [f32], frame_duration_seconds: f32) -> bool {
        let rms = (samples.iter().map(|sample| sample * sample).sum::<f32>()
            / samples.len() as f32)
            .sqrt();

        if rms < SILENCE_THRESHOLD_RMS {
            let smoothing = 1.0 - (-frame_duration_seconds / SILENCE_RESET_TIME_SECONDS).exp();
            self.gain += (1.0 - self.gain) * smoothing;
            samples.fill(0.0);
            return false;
        }

        let target_gain = (TARGET_RMS / rms).clamp(MIN_AUTO_GAIN, MAX_AUTO_GAIN);
        let time_constant = if target_gain < self.gain {
            GAIN_DOWN_TIME_SECONDS
        } else {
            GAIN_UP_TIME_SECONDS
        };
        let smoothing = 1.0 - (-frame_duration_seconds / time_constant).exp();
        self.gain += (target_gain - self.gain) * smoothing;

        for sample in samples {
            *sample *= self.gain;
        }
        true
    }
}

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

fn capture_loop(frequencies: watch::Sender<Vec<f32>>, ready: oneshot::Sender<Result<()>>) {
    let result = capture(frequencies, ready);
    if let Err(error) = result {
        eprintln!("Error de captura WASAPI: {error:#}");
    }
}

fn capture(frequencies: watch::Sender<Vec<f32>>, ready: oneshot::Sender<Result<()>>) -> Result<()> {
    initialize_mta()
        .ok()
        .context("No se pudo inicializar COM")?;

    let enumerator = DeviceEnumerator::new().context("No se pudo crear WASAPI enumerator")?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .context("No se encontró la salida WASAPI predeterminada")?;
    let mut audio_client = device
        .get_iaudioclient()
        .context("No se pudo abrir el cliente WASAPI")?;

    let format = WaveFormat::new(32, 32, &SampleType::Float, SAMPLE_RATE, CHANNELS, None);
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
    let mut sample_queue = VecDeque::with_capacity(FFT_SIZE * 2);
    let mut planner = RealFftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let mut input = vec![0.0; FFT_SIZE];
    let mut processed_input = vec![0.0; FFT_SIZE];
    let mut auto_gain = AutoGain::default();
    let mut spectrum = fft.make_output_vec();
    let mut scratch = fft.make_scratch_vec();
    let window: Vec<f32> = (0..FFT_SIZE)
        .map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / (FFT_SIZE - 1) as f32).cos())
        .collect();
    let sample_bytes = CHANNELS * std::mem::size_of::<f32>();
    let hop_duration = FFT_HOP_SIZE as f32 / SAMPLE_RATE as f32;
    let mut has_window = false;

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

        while byte_queue.len() >= sample_bytes {
            let left = take_f32(&mut byte_queue);
            let right = take_f32(&mut byte_queue);
            sample_queue.push_back((left + right) * 0.5);
        }

        loop {
            if has_window {
                if sample_queue.len() < FFT_HOP_SIZE {
                    break;
                }
                input.copy_within(FFT_HOP_SIZE.., 0);
                for sample in &mut input[FFT_SIZE - FFT_HOP_SIZE..] {
                    *sample = sample_queue
                        .pop_front()
                        .expect("se validó el tamaño del bloque");
                }
            } else {
                if sample_queue.len() < FFT_SIZE {
                    break;
                }
                for sample in &mut input {
                    *sample = sample_queue
                        .pop_front()
                        .expect("se validó el tamaño del bloque");
                }
                has_window = true;
            }

            processed_input.copy_from_slice(&input);
            let has_signal = auto_gain.apply(&mut processed_input, hop_duration);
            if has_signal {
                for (sample, weight) in processed_input.iter_mut().zip(&window) {
                    *sample *= weight;
                }
            }
            fft.process_with_scratch(&mut processed_input, &mut spectrum, &mut scratch)
                .context("Error calculando FFT")?;

            if has_signal {
                frequencies.send_replace(spectrum_to_bands(&spectrum));
            } else {
                frequencies.send_replace(vec![0.0; BANDS]);
            }
        }

        thread::sleep(Duration::from_millis(5));
    }
}

fn spectrum_to_bands(spectrum: &[Complex<f32>]) -> Vec<f32> {
    let max_bin = spectrum.len() - 1;
    (0..BANDS)
        .map(|band| {
            let start = (max_bin as f32).powf(band as f32 / BANDS as f32).floor() as usize;
            let end = (max_bin as f32)
                .powf((band + 1) as f32 / BANDS as f32)
                .ceil() as usize;
            let start = start.clamp(1, max_bin);
            let end = end.clamp(start + 1, max_bin + 1);

            // El pico conserva las notas agudas estrechas sin promediar su energia
            // con todos los bins de la banda.
            let peak = spectrum[start..end]
                .iter()
                .map(|value| value.norm())
                .fold(0.0_f32, f32::max);
            (peak * 16.0 / FFT_SIZE as f32).clamp(0.0, 1.0)
        })
        .collect()
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
        frequencies
            .changed()
            .await
            .context("La fuente FFT se cerró")?;
        let message = serde_json::to_string(&*frequencies.borrow())?;
        socket
            .send(Message::Text(message.into()))
            .await
            .context("No se pudieron enviar bandas FFT")?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equally_strong_notes_have_comparable_levels_across_the_spectrum() {
        let mut low_note = vec![Complex::new(0.0, 0.0); FFT_SIZE / 2 + 1];
        let mut mid_note = low_note.clone();
        let mut high_note = low_note.clone();
        low_note[4] = Complex::new(20.0, 0.0);
        mid_note[18] = Complex::new(20.0, 0.0);
        high_note[128] = Complex::new(20.0, 0.0);

        let peak_level = |spectrum: &[Complex<f32>]| {
            spectrum_to_bands(spectrum)
                .into_iter()
                .fold(0.0_f32, f32::max)
        };

        let low_level = peak_level(&low_note);
        let mid_level = peak_level(&mid_note);
        let high_level = peak_level(&high_note);
        assert!(low_level > 0.0);
        assert!((low_level - mid_level).abs() < 1e-6);
        assert!((mid_level - high_level).abs() < 1e-6);
    }

    #[test]
    fn spectrum_conversion_only_applies_fft_level_scaling() {
        let mut spectrum = vec![Complex::new(0.0, 0.0); FFT_SIZE / 2 + 1];
        spectrum[128] = Complex::new(20.0, 0.0);

        let bands = spectrum_to_bands(&spectrum);
        let expected_level = 20.0 * 16.0 / FFT_SIZE as f32;

        assert!(bands
            .iter()
            .any(|level| (*level - expected_level).abs() < 1e-6));
    }

    #[test]
    fn auto_gain_brings_different_input_levels_to_a_similar_target() {
        let mut quiet_gain = AutoGain::default();
        let mut loud_gain = AutoGain::default();
        let mut quiet_rms = 0.0;
        let mut loud_rms = 0.0;

        for frame in 0..120 {
            let mut quiet_frame: Vec<f32> = (0..FFT_SIZE)
                .map(|sample| {
                    0.01 * (std::f32::consts::TAU * 1_000.0 * (frame * FFT_SIZE + sample) as f32
                        / SAMPLE_RATE as f32)
                        .sin()
                })
                .collect();
            let mut loud_frame: Vec<f32> = quiet_frame.iter().map(|sample| sample * 10.0).collect();
            let frame_duration = FFT_SIZE as f32 / SAMPLE_RATE as f32;

            quiet_gain.apply(&mut quiet_frame, frame_duration);
            loud_gain.apply(&mut loud_frame, frame_duration);

            if frame == 119 {
                quiet_rms = sample_rms(&quiet_frame);
                loud_rms = sample_rms(&loud_frame);
            }
        }

        assert!((quiet_rms - loud_rms).abs() < 0.005);
        assert!((quiet_rms - TARGET_RMS).abs() < 0.01);
        assert!((loud_rms - TARGET_RMS).abs() < 0.01);
    }

    #[test]
    fn auto_gain_mutes_silence_instead_of_amplifying_noise() {
        let mut auto_gain = AutoGain::default();
        let mut silence = vec![0.0001; FFT_SIZE];

        assert!(!auto_gain.apply(&mut silence, FFT_SIZE as f32 / SAMPLE_RATE as f32));
        assert!(silence.iter().all(|sample| *sample == 0.0));
    }

    fn sample_rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
    }
}
