use crate::settings::AppSettings;
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "settings.json";

#[tauri::command]
pub fn get_settings(app_handle: tauri::AppHandle) -> AppSettings {
    let store = app_handle.store(STORE_PATH);
    match store {
        Ok(store) => {
            let model = store.get("selected_model")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "large-v3-turbo-q5".to_string());
            let device = store.get("selected_device")
                .and_then(|v| v.as_str().map(|s| s.to_string()));
            let theme = store.get("theme")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "dark".to_string());
            let shortcut = store.get("shortcut")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "Ctrl+Shift+Space".to_string());
            let recording_mode = store.get("recording_mode")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "button".to_string());
            let vad_threshold = store.get("vad_threshold")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.3) as f32;
            let auto_paste = store.get("auto_paste")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let language = store.get("language")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "tr".to_string());
            let transcription_engine = store.get("transcription_engine")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "web".to_string());
            let voice_activation = store.get("voice_activation")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let wake_word = store.get("wake_word")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "fısıltı".to_string());
            let sound_enabled = store.get("sound_enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let auto_start = store.get("auto_start")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let silence_timeout = store.get("silence_timeout")
                .and_then(|v| v.as_f64())
                .unwrap_or(4.0) as f32;
            let max_record_duration = store.get("max_record_duration")
                .and_then(|v| v.as_f64())
                .unwrap_or(60.0) as f32;
            let turkish_corrections = store.get("turkish_corrections")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let hallucination_filter = store.get("hallucination_filter")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let overlay_follow_cursor = store.get("overlay_follow_cursor")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let auto_punctuation = store.get("auto_punctuation")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let auto_capitalization = store.get("auto_capitalization")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let preserve_english_words = store.get("preserve_english_words")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let auto_comma = store.get("auto_comma")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let paragraph_break = store.get("paragraph_break")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let notifications = store.get("notifications")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let log_level = store.get("log_level")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "info".to_string());

            AppSettings {
                selected_model: model,
                selected_device: device,
                theme,
                shortcut,
                recording_mode,
                vad_threshold,
                auto_paste,
                language,
                transcription_engine,
                voice_activation,
                wake_word,
                sound_enabled,
                auto_start,
                silence_timeout,
                max_record_duration,
                turkish_corrections,
                hallucination_filter,
                overlay_follow_cursor,
                auto_punctuation,
                auto_capitalization,
                preserve_english_words,
                auto_comma,
                paragraph_break,
                notifications,
                log_level,
            }
        }
        Err(_) => AppSettings::default(),
    }
}

#[tauri::command]
pub fn save_settings(app_handle: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let store = app_handle.store(STORE_PATH)
        .map_err(|e| format!("Store acilamadi: {}", e))?;

    store.set("selected_model", serde_json::json!(settings.selected_model));
    store.set("selected_device", serde_json::json!(settings.selected_device));
    store.set("theme", serde_json::json!(settings.theme));
    store.set("shortcut", serde_json::json!(settings.shortcut));
    store.set("recording_mode", serde_json::json!(settings.recording_mode));
    store.set("vad_threshold", serde_json::json!(settings.vad_threshold));
    store.set("auto_paste", serde_json::json!(settings.auto_paste));
    store.set("language", serde_json::json!(settings.language));
    store.set("transcription_engine", serde_json::json!(settings.transcription_engine));
    store.set("voice_activation", serde_json::json!(settings.voice_activation));
    store.set("wake_word", serde_json::json!(settings.wake_word));
    store.set("sound_enabled", serde_json::json!(settings.sound_enabled));
    store.set("auto_start", serde_json::json!(settings.auto_start));
    store.set("silence_timeout", serde_json::json!(settings.silence_timeout));
    store.set("max_record_duration", serde_json::json!(settings.max_record_duration));
    store.set("turkish_corrections", serde_json::json!(settings.turkish_corrections));
    store.set("hallucination_filter", serde_json::json!(settings.hallucination_filter));
    store.set("overlay_follow_cursor", serde_json::json!(settings.overlay_follow_cursor));
    store.set("auto_punctuation", serde_json::json!(settings.auto_punctuation));
    store.set("auto_capitalization", serde_json::json!(settings.auto_capitalization));
    store.set("preserve_english_words", serde_json::json!(settings.preserve_english_words));
    store.set("auto_comma", serde_json::json!(settings.auto_comma));
    store.set("paragraph_break", serde_json::json!(settings.paragraph_break));
    store.set("notifications", serde_json::json!(settings.notifications));
    store.set("log_level", serde_json::json!(settings.log_level));

    store.save().map_err(|e| format!("Ayarlar kaydedilemedi: {}", e))?;

    log::info!("Ayarlar kaydedildi: {:?}", settings);
    Ok(())
}
