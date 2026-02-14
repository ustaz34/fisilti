import { emit } from "@tauri-apps/api/event";
import { useSettingsStore, type AppSettings } from "../stores/settingsStore";
import { saveSettings } from "./tauri-commands";

/**
 * AppSettings (camelCase) -> Backend (snake_case) donusumu.
 * Tek bir kaynak (single source of truth).
 */
export function toBackend(s: AppSettings) {
  return {
    selected_model: s.selectedModel,
    selected_device: s.selectedDevice,
    theme: s.theme,
    shortcut: s.shortcut,
    recording_mode: s.recordingMode,
    vad_threshold: s.vadThreshold,
    auto_paste: s.autoPaste,
    language: s.language,
    transcription_engine: s.transcriptionEngine,
    deepgram_api_key: s.deepgramApiKey,
    azure_speech_key: s.azureSpeechKey,
    azure_speech_region: s.azureSpeechRegion,
    google_cloud_api_key: s.googleCloudApiKey,
    voice_activation: s.voiceActivation,
    wake_word: s.wakeWord,
    sound_enabled: s.soundEnabled,
    auto_start: s.autoStart,
    silence_timeout: s.silenceTimeout,
    max_record_duration: s.maxRecordDuration,
    turkish_corrections: s.turkishCorrections,
    hallucination_filter: s.hallucinationFilter,
    overlay_follow_cursor: s.overlayFollowCursor,
    auto_punctuation: s.autoPunctuation,
    auto_capitalization: s.autoCapitalization,
    preserve_english_words: s.preserveEnglishWords,
    auto_comma: s.autoComma,
    paragraph_break: s.paragraphBreak,
    notifications: s.notifications,
    log_level: s.logLevel,
    tts_shortcut: s.ttsShortcut ?? "Ctrl+Shift+R",
    translate_engine: s.translateEngine ?? "google",
    deepl_api_key: s.deeplApiKey ?? "",
    translate_target_lang: s.translateTargetLang ?? "en",
    translate_source_lang: s.translateSourceLang ?? "auto",
    translate_auto_detect: s.translateAutoDetect ?? true,
    translate_shortcut: s.translateShortcut ?? "Ctrl+Shift+T",
    ai_provider: s.aiProvider ?? "groq",
    groq_api_key: s.groqApiKey ?? "",
    gemini_api_key: s.geminiApiKey ?? "",
    ollama_model: s.ollamaModel ?? "llama3.1",
    features: {
      voice_commands: s.features?.voiceCommands ?? true,
      sentiment: s.features?.sentiment ?? false,
      gamification: s.features?.gamification ?? true,
      templates: s.features?.templates ?? true,
      three_d_visualizer: s.features?.threeDVisualizer ?? false,
      live_captions: s.features?.liveCaptions ?? true,
      ambient_theme: s.features?.ambientTheme ?? false,
      meeting_mode: s.features?.meetingMode ?? true,
      ai_assistant: s.features?.aiAssistant ?? false,
      collaboration: s.features?.collaboration ?? true,
      clipboard_manager: s.features?.clipboardManager ?? true,
      mouse_gestures: s.features?.mouseGestures ?? false,
      radial_menu: s.features?.radialMenu ?? false,
      live_translation: s.features?.liveTranslation ?? false,
    },
  };
}

/**
 * Ayarlari guvenli sekilde kaydet:
 * 1. Zustand'i guncelle (updateSettings)
 * 2. Son durumu oku (getState().settings)
 * 3. Backend'e kaydet (saveSettings(toBackend(cur)))
 * 4. Event yayinla (emit("settings-changed", cur))
 */
export async function persistSettings(partial: Partial<AppSettings>) {
  const { updateSettings } = useSettingsStore.getState();
  updateSettings(partial);
  const cur = useSettingsStore.getState().settings;
  try {
    await saveSettings(toBackend(cur));
    await emit("settings-changed", cur);
  } catch (e) {
    console.error("Settings save error:", e);
  }
}
