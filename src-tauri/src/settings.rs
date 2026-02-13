use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AppSettings {
    pub selected_model: String,
    pub selected_device: Option<String>,
    pub theme: String,
    pub shortcut: String,
    pub recording_mode: String,
    pub vad_threshold: f32,
    pub auto_paste: bool,
    pub language: String,
    pub transcription_engine: String,
    pub deepgram_api_key: String,
    pub azure_speech_key: String,
    pub azure_speech_region: String,
    pub google_cloud_api_key: String,
    pub voice_activation: bool,
    pub wake_word: String,
    pub sound_enabled: bool,
    pub auto_start: bool,
    pub silence_timeout: f32,
    pub max_record_duration: f32,
    pub turkish_corrections: bool,
    pub hallucination_filter: bool,
    pub overlay_follow_cursor: bool,
    // Metin Isleme
    pub auto_punctuation: bool,
    pub auto_capitalization: bool,
    pub preserve_english_words: bool,
    pub auto_comma: bool,
    pub paragraph_break: bool,
    // Sistem
    pub notifications: bool,
    pub log_level: String,
    // TTS
    #[serde(default = "default_tts_shortcut")]
    pub tts_shortcut: String,
}

fn default_tts_shortcut() -> String {
    "Ctrl+Shift+R".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            selected_model: "large-v3-turbo-q5".to_string(),
            selected_device: None,
            theme: "dark".to_string(),
            shortcut: "Ctrl+Shift+Space".to_string(),
            recording_mode: "button".to_string(),
            vad_threshold: 0.3,
            auto_paste: true,
            language: "tr".to_string(),
            transcription_engine: "web".to_string(),
            deepgram_api_key: String::new(),
            azure_speech_key: String::new(),
            azure_speech_region: String::new(),
            google_cloud_api_key: String::new(),
            voice_activation: false,
            wake_word: "fısıltı".to_string(),
            sound_enabled: true,
            auto_start: false,
            silence_timeout: 4.0,
            max_record_duration: 60.0,
            turkish_corrections: true,
            hallucination_filter: true,
            overlay_follow_cursor: true,
            auto_punctuation: true,
            auto_capitalization: true,
            preserve_english_words: true,
            auto_comma: true,
            paragraph_break: false,
            notifications: true,
            log_level: "info".to_string(),
            tts_shortcut: "Ctrl+Shift+R".to_string(),
        }
    }
}
