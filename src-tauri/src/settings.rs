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
    // Ceviri
    #[serde(default = "default_translate_engine")]
    pub translate_engine: String,
    #[serde(default)]
    pub deepl_api_key: String,
    #[serde(default = "default_translate_target_lang")]
    pub translate_target_lang: String,
    #[serde(default = "default_translate_source_lang")]
    pub translate_source_lang: String,
    #[serde(default = "default_true")]
    pub translate_auto_detect: bool,
    #[serde(default = "default_translate_shortcut")]
    pub translate_shortcut: String,
    // AI Asistan
    #[serde(default = "default_ai_provider")]
    pub ai_provider: String,
    #[serde(default)]
    pub groq_api_key: String,
    #[serde(default)]
    pub gemini_api_key: String,
    #[serde(default = "default_ollama_model")]
    pub ollama_model: String,
    // Canli Ceviri
    #[serde(default)]
    pub live_translation_source_lang: String,
    #[serde(default = "default_live_translation_target_lang")]
    pub live_translation_target_lang: String,
    #[serde(default)]
    pub live_translation_device_id: Option<String>,
    #[serde(default = "default_vad_sensitivity")]
    pub live_translation_vad_sensitivity: String,
    #[serde(default = "default_live_translation_shortcut")]
    pub live_translation_shortcut: String,
    // Feature Flags
    #[serde(default)]
    pub features: FeatureFlags,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct FeatureFlags {
    #[serde(default = "default_true")]
    pub voice_commands: bool,
    #[serde(default)]
    pub sentiment: bool,
    #[serde(default = "default_true")]
    pub gamification: bool,
    #[serde(default = "default_true")]
    pub templates: bool,
    #[serde(default)]
    pub three_d_visualizer: bool,
    #[serde(default = "default_true")]
    pub live_captions: bool,
    #[serde(default)]
    pub ambient_theme: bool,
    #[serde(default = "default_true")]
    pub meeting_mode: bool,
    #[serde(default)]
    pub ai_assistant: bool,
    #[serde(default = "default_true")]
    pub collaboration: bool,
    #[serde(default = "default_true")]
    pub clipboard_manager: bool,
    #[serde(default)]
    pub mouse_gestures: bool,
    #[serde(default)]
    pub radial_menu: bool,
    #[serde(default)]
    pub live_translation: bool,
}

impl Default for FeatureFlags {
    fn default() -> Self {
        Self {
            voice_commands: true,
            sentiment: false,
            gamification: true,
            templates: true,
            three_d_visualizer: false,
            live_captions: true,
            ambient_theme: false,
            meeting_mode: true,
            ai_assistant: false,
            collaboration: true,
            clipboard_manager: true,
            mouse_gestures: false,
            radial_menu: false,
            live_translation: false,
        }
    }
}

fn default_ai_provider() -> String {
    "groq".to_string()
}

fn default_ollama_model() -> String {
    "llama3.1".to_string()
}

fn default_tts_shortcut() -> String {
    "Ctrl+Shift+R".to_string()
}

fn default_translate_engine() -> String {
    "google".to_string()
}

fn default_translate_target_lang() -> String {
    "en".to_string()
}

fn default_translate_source_lang() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

fn default_translate_shortcut() -> String {
    "Ctrl+Shift+T".to_string()
}

fn default_live_translation_target_lang() -> String {
    "en".to_string()
}

fn default_vad_sensitivity() -> String {
    "medium".to_string()
}

fn default_live_translation_shortcut() -> String {
    "Ctrl+Shift+L".to_string()
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
            translate_engine: "google".to_string(),
            deepl_api_key: String::new(),
            translate_target_lang: "en".to_string(),
            translate_source_lang: "auto".to_string(),
            translate_auto_detect: true,
            translate_shortcut: "Ctrl+Shift+T".to_string(),
            ai_provider: "groq".to_string(),
            groq_api_key: String::new(),
            gemini_api_key: String::new(),
            ollama_model: "llama3.1".to_string(),
            live_translation_source_lang: String::new(),
            live_translation_target_lang: "en".to_string(),
            live_translation_device_id: None,
            live_translation_vad_sensitivity: "medium".to_string(),
            live_translation_shortcut: "Ctrl+Shift+L".to_string(),
            features: FeatureFlags::default(),
        }
    }
}
