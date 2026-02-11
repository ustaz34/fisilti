use crate::commands::settings::get_settings;
use crate::corrections;
use crate::model;
use crate::text;
use crate::transcription;
use serde::Serialize;

#[derive(Serialize)]
pub struct TranscriptionResponse {
    pub text: String,
    pub duration_ms: u64,
    pub status: String,
}

#[tauri::command]
pub fn transcribe_audio(
    app_handle: tauri::AppHandle,
    audio_data: Vec<f32>,
    model_id: String,
) -> Result<TranscriptionResponse, String> {
    let settings = get_settings(app_handle.clone());

    let models_dir = model::get_models_dir(&app_handle);
    let model_path = model::get_model_path(&models_dir, &model_id)
        .ok_or_else(|| format!("Model bulunamadi: {}", model_id))?;

    if !model_path.exists() {
        return Err("Model dosyasi bulunamadi. Lutfen once modeli indirin.".to_string());
    }

    // Dinamik prompt ile transkripsiyon
    let result = transcription::transcribe_audio_data(&audio_data, &model_path, &settings.language)?;

    // Kullanici duzeltme haritasini al
    let user_corrections = corrections::get_corrections_map();
    let corrections_opt = if user_corrections.is_empty() { None } else { Some(&user_corrections) };

    let (processed_text, learned_pairs) = text::process_text_and_learn(
        &result.text,
        &settings.language,
        settings.turkish_corrections,
        settings.hallucination_filter,
        corrections_opt,
        settings.auto_punctuation,
        settings.auto_capitalization,
        settings.preserve_english_words,
        settings.auto_comma,
        settings.paragraph_break,
    );

    // Pipeline'in yaptigi duzeltmeleri ogrenme sozlugune kaydet
    for (wrong, right) in &learned_pairs {
        corrections::add_correction(wrong, right);
    }
    if !learned_pairs.is_empty() {
        corrections::save_corrections(&app_handle);
        log::info!("Pipeline'dan {} duzeltme ogrendi", learned_pairs.len());
    }

    // N-gram ve sik kelime istatistiklerini guncelle
    if !processed_text.is_empty() {
        corrections::update_ngrams(&processed_text);
        corrections::update_frequent_words(&processed_text);
        corrections::save_profile(&app_handle);
    }

    Ok(TranscriptionResponse {
        text: processed_text,
        duration_ms: result.duration_ms,
        status: "tamamlandi".to_string(),
    })
}

#[tauri::command]
pub fn process_text_command(
    app_handle: tauri::AppHandle,
    text: String,
) -> Result<String, String> {
    let settings = get_settings(app_handle.clone());

    // Kullanici duzeltme haritasini al
    let user_corrections = corrections::get_corrections_map();
    let corrections_opt = if user_corrections.is_empty() { None } else { Some(&user_corrections) };

    let (processed, learned_pairs) = text::process_text_and_learn(
        &text,
        &settings.language,
        settings.turkish_corrections,
        settings.hallucination_filter,
        corrections_opt,
        settings.auto_punctuation,
        settings.auto_capitalization,
        settings.preserve_english_words,
        settings.auto_comma,
        settings.paragraph_break,
    );

    // Pipeline'in yaptigi duzeltmeleri ogrenme sozlugune kaydet
    for (wrong, right) in &learned_pairs {
        corrections::add_correction(wrong, right);
    }
    if !learned_pairs.is_empty() {
        corrections::save_corrections(&app_handle);
        log::info!("Pipeline'dan {} duzeltme ogrendi (process_text)", learned_pairs.len());
    }

    // N-gram ve sik kelime istatistiklerini guncelle
    if !processed.is_empty() {
        corrections::update_ngrams(&processed);
        corrections::update_frequent_words(&processed);
        corrections::save_profile(&app_handle);
    }

    Ok(processed)
}

#[tauri::command]
pub fn get_transcription_status() -> String {
    "hazir".to_string()
}
