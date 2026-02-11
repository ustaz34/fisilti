use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use rubato::{SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction, Resampler};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Clone, serde::Serialize)]
pub struct AudioDevice {
    pub name: String,
    pub id: String,
}

pub struct SharedAudioState {
    pub is_recording: Arc<AtomicBool>,
    pub audio_buffer: Arc<Mutex<Vec<f32>>>,
    pub level: Arc<Mutex<f32>>,
    pub sample_rate: Mutex<u32>,
}

impl SharedAudioState {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
            level: Arc::new(Mutex::new(0.0)),
            sample_rate: Mutex::new(0),
        }
    }
}

pub fn list_devices() -> Vec<AudioDevice> {
    let host = cpal::default_host();
    let mut devices = Vec::new();

    if let Ok(input_devices) = host.input_devices() {
        for device in input_devices {
            if let Ok(name) = device.name() {
                devices.push(AudioDevice {
                    id: name.clone(),
                    name,
                });
            }
        }
    }

    devices
}

pub fn start_recording(
    state: &SharedAudioState,
    device_name: Option<String>,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();

    let device = if let Some(name) = device_name {
        host.input_devices()
            .map_err(|e| format!("Cihaz listesi alinamadi: {}", e))?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false))
            .ok_or_else(|| format!("Cihaz bulunamadi: {}", name))?
    } else {
        host.default_input_device()
            .ok_or_else(|| "Varsayilan mikrofon bulunamadi".to_string())?
    };

    let config = device
        .default_input_config()
        .map_err(|e| format!("Mikrofon yapilandirmasi alinamadi: {}", e))?;

    let sample_rate = config.sample_rate().0;
    *state.sample_rate.lock() = sample_rate;
    let channels = config.channels() as usize;

    state.audio_buffer.lock().clear();
    state.is_recording.store(true, Ordering::SeqCst);

    let is_recording = state.is_recording.clone();
    let audio_buffer = state.audio_buffer.clone();
    let level = state.level.clone();

    let stream_config: cpal::StreamConfig = config.into();

    let stream = device
        .build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if !is_recording.load(Ordering::SeqCst) {
                    return;
                }

                // Mono'ya donustur (ilk kanal)
                let mono: Vec<f32> = data
                    .chunks(channels)
                    .map(|chunk| chunk[0])
                    .collect();

                // Seviye hesapla (RMS)
                let rms = (mono.iter().map(|s| s * s).sum::<f32>() / mono.len() as f32).sqrt();
                *level.lock() = rms;

                audio_buffer.lock().extend_from_slice(&mono);
            },
            move |err| {
                log::error!("Ses yakalama hatasi: {}", err);
            },
            None,
        )
        .map_err(|e| format!("Ses akisi baslatilamadi: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Ses akisi oynatma hatasi: {}", e))?;

    log::info!("Kayit basladi - {}Hz, {} kanal", sample_rate, channels);

    Ok(stream)
}

pub fn stop_recording(state: &SharedAudioState) -> Result<Vec<f32>, String> {
    state.is_recording.store(false, Ordering::SeqCst);

    let raw_audio = {
        let mut buf = state.audio_buffer.lock();
        std::mem::take(&mut *buf)
    };

    if raw_audio.is_empty() {
        return Err("Ses verisi bos".to_string());
    }

    let sample_rate = *state.sample_rate.lock();

    // 16kHz'e resample et (Whisper icin)
    let resampled = if sample_rate != 16000 {
        resample_audio(&raw_audio, sample_rate, 16000)?
    } else {
        raw_audio
    };

    log::info!(
        "Kayit durduruldu - {} ornek ({:.1}s)",
        resampled.len(),
        resampled.len() as f64 / 16000.0
    );

    Ok(resampled)
}

pub fn get_level(state: &SharedAudioState) -> f32 {
    *state.level.lock()
}

fn resample_audio(input: &[f32], from_rate: u32, to_rate: u32) -> Result<Vec<f32>, String> {
    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = to_rate as f64 / from_rate as f64;
    let chunk_size = 1024;

    let mut resampler = SincFixedIn::<f32>::new(
        ratio,
        2.0,
        params,
        chunk_size,
        1, // mono
    )
    .map_err(|e| format!("Resampler olusturulamadi: {}", e))?;

    let mut output = Vec::new();

    for chunk in input.chunks(chunk_size) {
        let input_chunk = if chunk.len() < chunk_size {
            let mut padded = chunk.to_vec();
            padded.resize(chunk_size, 0.0);
            padded
        } else {
            chunk.to_vec()
        };

        let result = resampler
            .process(&[input_chunk], None)
            .map_err(|e| format!("Resample hatasi: {}", e))?;

        if !result.is_empty() {
            output.extend_from_slice(&result[0]);
        }
    }

    Ok(output)
}
