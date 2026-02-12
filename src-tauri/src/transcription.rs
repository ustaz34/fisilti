use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::OnceLock;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct TranscriptionResult {
    pub text: String,
    pub duration_ms: u64,
}

struct CachedModel {
    ctx: WhisperContext,
    model_path: String,
}

static CACHED_MODEL: OnceLock<Mutex<Option<CachedModel>>> = OnceLock::new();

fn get_cache() -> &'static Mutex<Option<CachedModel>> {
    CACHED_MODEL.get_or_init(|| Mutex::new(None))
}

/// Maksimum ses uzunlugu: 60 saniye (16kHz * 60 = 960000 sample)
const MAX_AUDIO_SAMPLES: usize = 16000 * 60;
/// Minimum ses uzunlugu: 0.5 saniye
const MIN_AUDIO_SAMPLES: usize = 8000;
/// Sessizlik RMS esigi
const SILENCE_RMS_THRESHOLD: f32 = 0.001;

pub fn transcribe_audio_data(
    audio_data: &[f32],
    model_path: &PathBuf,
    language: &str,
) -> Result<TranscriptionResult, String> {
    let start = std::time::Instant::now();

    if !model_path.exists() {
        return Err("Model dosyasi bulunamadi. Lutfen once bir model indirin.".to_string());
    }

    // Cok kisa ses kontrolu
    if audio_data.len() < MIN_AUDIO_SAMPLES {
        log::info!("Ses cok kisa ({} sample), atlaniyor", audio_data.len());
        return Ok(TranscriptionResult {
            text: String::new(),
            duration_ms: 0,
        });
    }

    // Sessizlik kontrolu - RMS enerji hesapla
    let rms = calculate_rms(audio_data);
    log::info!("Ses RMS seviyesi: {:.6}", rms);
    if rms < SILENCE_RMS_THRESHOLD {
        log::info!("Ses cok sessiz (RMS: {:.6}), atlaniyor", rms);
        return Ok(TranscriptionResult {
            text: String::new(),
            duration_ms: 0,
        });
    }

    // High-pass filtre uygula (50Hz alti gurultuyu kes — Turkce fricatifler icin 80Hz cok agresif)
    let audio_data = apply_high_pass_filter(audio_data, 50.0, 16000.0);

    // Sesi normaliz et
    let mut audio_data = normalize_audio(&audio_data);

    // Maksimum uzunluga kirp (60 saniye)
    if audio_data.len() > MAX_AUDIO_SAMPLES {
        log::info!(
            "Ses {} saniyeye kirpildi (orijinal: {} saniye)",
            MAX_AUDIO_SAMPLES / 16000,
            audio_data.len() / 16000
        );
        audio_data.truncate(MAX_AUDIO_SAMPLES);
    }

    // Bas ve son sessizligi kirp (0.005: kelime sinirlarini korumak icin daha toleransli)
    audio_data = trim_silence(&audio_data, 0.005);
    if audio_data.len() < MIN_AUDIO_SAMPLES {
        log::info!("Sessizlik kirpma sonrasi ses cok kisa, atlaniyor");
        return Ok(TranscriptionResult {
            text: String::new(),
            duration_ms: 0,
        });
    }

    let model_str = model_path
        .to_str()
        .ok_or_else(|| "Model yolu gecersiz".to_string())?
        .to_string();

    let mut cache = get_cache().lock();

    let needs_reload = match &*cache {
        Some(cached) => cached.model_path != model_str,
        None => true,
    };

    if needs_reload {
        log::info!("Model yukleniyor: {}", model_str);
        let ctx =
            WhisperContext::new_with_params(&model_str, WhisperContextParameters::default())
                .map_err(|e| format!("Model yuklenemedi: {}", e))?;
        *cache = Some(CachedModel {
            ctx,
            model_path: model_str.clone(),
        });
        log::info!("Model yuklendi: {:.1}s", start.elapsed().as_secs_f64());
    }

    let cached = cache.as_ref().unwrap();

    let mut state = cached
        .ctx
        .create_state()
        .map_err(|e| format!("Whisper state olusturulamadi: {}", e))?;

    // BeamSearch decoding — Turkce gibi morfolojik diller icin cok daha dogru
    // Greedy'den 2-3x yavas ama kelime dogrulugu %15-20 daha iyi
    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: 1.0,
    });

    // Dil ayarlari
    params.set_language(Some(language));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_single_segment(false);

    // Kisa kayitlarda tek segment kullan (daha hizli)
    let audio_secs = audio_data.len() as f64 / 16000.0;
    if audio_secs < 15.0 {
        params.set_single_segment(true);
    }

    // Turkce baglam-bagimli: unlu uyumu, ek morfolojisi icin context her zaman acik
    params.set_no_context(false);

    // Timestamp'ler
    params.set_no_timestamps(true);
    params.set_max_len(0);

    // Dinamik initial prompt - dil + domain + kullanici kelimeleri
    // Fallback: kullanici profili bossa statik prompt kullan
    let dynamic_prompt = crate::corrections::build_dynamic_prompt(language);
    params.set_initial_prompt(&dynamic_prompt);

    // Kalite/performans ayarlari
    params.set_n_threads(num_cpus());
    params.set_entropy_thold(2.4);
    // Sicaklik 0.0 = tamamen deterministik (en dogru tek sonuc)
    params.set_temperature(0.0);

    // Halusinasyon onleme — non-speech token'lari bastir, gercek konusmayi reddetmesin
    params.set_no_speech_thold(0.3);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);

    // BeamSearch: sicaklik artisi ile fallback (ilk sonuc basarisizsa 0.2 ile tekrar dene)
    params.set_temperature_inc(0.2);
    params.set_logprob_thold(-0.8);

    state
        .full(params, &audio_data)
        .map_err(|e| format!("Transkripsiyon hatasi: {}", e))?;

    let num_segments = state.full_n_segments();

    let mut text = String::new();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            if let Ok(segment_text) = segment.to_str_lossy() {
                let seg = segment_text.trim();
                if seg.is_empty() { continue; }
                if !text.is_empty() && !text.ends_with(' ') {
                    text.push(' ');
                }
                text.push_str(seg);
            }
        }
    }

    let text = text.trim().to_string();
    let duration_ms = start.elapsed().as_millis() as u64;

    log::info!(
        "Transkripsiyon tamamlandi: {}ms, {} karakter, metin: {}",
        duration_ms,
        text.len(),
        &text
    );

    Ok(TranscriptionResult { text, duration_ms })
}

/// High-pass filtre (basit birinci derece IIR)
fn apply_high_pass_filter(audio: &[f32], cutoff_hz: f32, sample_rate: f32) -> Vec<f32> {
    if audio.is_empty() {
        return Vec::new();
    }

    let rc = 1.0 / (2.0 * std::f32::consts::PI * cutoff_hz);
    let dt = 1.0 / sample_rate;
    let alpha = rc / (rc + dt);

    let mut filtered = Vec::with_capacity(audio.len());
    filtered.push(audio[0]);

    for i in 1..audio.len() {
        let y = alpha * (filtered[i - 1] + audio[i] - audio[i - 1]);
        filtered.push(y);
    }

    filtered
}

/// RMS (Root Mean Square) enerji hesapla
fn calculate_rms(audio: &[f32]) -> f32 {
    if audio.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = audio.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    (sum_sq / audio.len() as f64).sqrt() as f32
}

/// Bas ve son sessizligi kirp
fn trim_silence(audio: &[f32], threshold: f32) -> Vec<f32> {
    if audio.is_empty() {
        return Vec::new();
    }

    let window = 160; // 10ms @ 16kHz

    // Bastan sessizligi bul
    // Padding: 3200 sample = 200ms (Turkce yumusak baslangicli sesler: ğ, ş, ç)
    let padding = 3200usize;
    let mut start_idx = 0;
    for chunk_start in (0..audio.len()).step_by(window) {
        let chunk_end = (chunk_start + window).min(audio.len());
        let chunk = &audio[chunk_start..chunk_end];
        let chunk_rms = {
            let sum_sq: f64 = chunk.iter().map(|s| (*s as f64) * (*s as f64)).sum();
            (sum_sq / chunk.len() as f64).sqrt() as f32
        };
        if chunk_rms > threshold {
            start_idx = chunk_start.saturating_sub(padding);
            break;
        }
        start_idx = chunk_start;
    }

    // Sondan sessizligi bul
    let mut end_idx = audio.len();
    for chunk_start in (0..audio.len()).step_by(window).rev() {
        let chunk_end = (chunk_start + window).min(audio.len());
        let chunk = &audio[chunk_start..chunk_end];
        let chunk_rms = {
            let sum_sq: f64 = chunk.iter().map(|s| (*s as f64) * (*s as f64)).sum();
            (sum_sq / chunk.len() as f64).sqrt() as f32
        };
        if chunk_rms > threshold {
            end_idx = (chunk_end + padding).min(audio.len());
            break;
        }
        end_idx = chunk_start;
    }

    if start_idx >= end_idx {
        return Vec::new();
    }

    audio[start_idx..end_idx].to_vec()
}

/// Ses verisini normalize et - peak normalizasyon
fn normalize_audio(audio: &[f32]) -> Vec<f32> {
    if audio.is_empty() {
        return Vec::new();
    }

    let peak = audio.iter().map(|s| s.abs()).fold(0.0f32, f32::max);

    if peak < 1e-6 {
        return audio.to_vec();
    }

    let target_peak = 0.85;
    let gain = (target_peak / peak).min(25.0);

    audio.iter().map(|s| (s * gain).clamp(-1.0, 1.0)).collect()
}

fn num_cpus() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
        .min(8)
}

