import { invoke } from "@tauri-apps/api/core";

export interface AudioDevice {
  name: string;
  id: string;
}

export interface WhisperModel {
  id: string;
  name: string;
  size_bytes: number;
  size_display: string;
  url: string;
  filename: string;
  description: string;
  downloaded: boolean;
}

export interface DownloadProgress {
  model_id: string;
  downloaded_bytes: number;
  total_bytes: number;
  percent: number;
  speed_bps: number;
  status: string;
}

export interface TranscriptionResponse {
  text: string;
  duration_ms: number;
  status: string;
}

export interface AppSettings {
  selected_model: string;
  selected_device: string | null;
  theme: string;
  shortcut: string;
  recording_mode: string;
  vad_threshold: number;
  auto_paste: boolean;
  language: string;
  transcription_engine: string;
  voice_activation: boolean;
  wake_word: string;
  sound_enabled: boolean;
  auto_start: boolean;
  silence_timeout: number;
  max_record_duration: number;
  turkish_corrections: boolean;
  hallucination_filter: boolean;
  overlay_follow_cursor: boolean;
  auto_punctuation: boolean;
  auto_capitalization: boolean;
  preserve_english_words: boolean;
  auto_comma: boolean;
  paragraph_break: boolean;
  notifications: boolean;
  log_level: string;
}

export interface HistoryEntry {
  id: string;
  text: string;
  timestamp: number;
  duration_ms: number;
  engine: string;
  language: string;
  model_id: string;
}

export async function listAudioDevices(): Promise<AudioDevice[]> {
  return invoke("list_audio_devices");
}

export async function startRecording(
  deviceName?: string,
): Promise<void> {
  return invoke("start_recording", { deviceName: deviceName ?? null });
}

export async function stopRecording(): Promise<number[]> {
  return invoke("stop_recording");
}

export async function getAudioLevels(): Promise<number> {
  return invoke("get_audio_levels");
}

export async function transcribeAudio(
  audioData: number[],
  modelId: string,
): Promise<TranscriptionResponse> {
  return invoke("transcribe_audio", { audioData, modelId });
}

export async function getTranscriptionStatus(): Promise<string> {
  return invoke("get_transcription_status");
}

export async function listModels(): Promise<WhisperModel[]> {
  return invoke("list_models");
}

export async function downloadModel(modelId: string): Promise<void> {
  return invoke("download_model", { modelId });
}

export async function getDownloadProgress(
  modelId: string,
): Promise<DownloadProgress | null> {
  return invoke("get_download_progress", { modelId });
}

export async function deleteModel(modelId: string): Promise<void> {
  return invoke("delete_model", { modelId });
}

export async function getSettings(): Promise<AppSettings> {
  return invoke("get_settings");
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke("save_settings", { settings });
}

export async function pasteToActiveApp(text: string): Promise<void> {
  return invoke("paste_to_active_app", { text });
}

export async function showMainWindow(): Promise<void> {
  return invoke("show_main_window");
}

export async function hideMainWindow(): Promise<void> {
  return invoke("hide_main_window");
}

export async function changeShortcut(shortcut: string): Promise<void> {
  return invoke("change_shortcut", { shortcut });
}

export async function saveForegroundWindow(): Promise<void> {
  return invoke("save_foreground_window");
}

export async function restoreForegroundWindow(): Promise<void> {
  return invoke("restore_foreground_window");
}

export async function saveHistoryEntry(entry: HistoryEntry): Promise<void> {
  return invoke("save_history_entry", { entry });
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return invoke("get_history");
}

export async function clearHistory(): Promise<void> {
  return invoke("clear_history");
}

export async function setOverlayFollowCursor(enabled: boolean): Promise<void> {
  return invoke("set_overlay_follow_cursor", { enabled });
}

export async function processText(text: string): Promise<string> {
  return invoke("process_text_command", { text });
}

// ─── Kullanici Duzeltme Sozlugu ───

export interface UserCorrection {
  wrong: string;
  right: string;
  count: number;
  last_seen: number;
}

export interface UserProfile {
  domain: string;
  frequent_words: string[];
  ngrams: NgramEntry[];
  total_transcriptions: number;
  total_corrections: number;
}

export interface DynamicPromptPreview {
  base_prompt: string;
  domain_addition: string;
  user_terms: string;
  total_length: number;
  max_length: number;
}

export interface NgramEntry {
  ngram: string;
  count: number;
}

export interface DomainInfo {
  detected: string;
  scores: Record<string, number>;
  explanation: string;
}

export async function addUserCorrection(wrong: string, right: string): Promise<void> {
  return invoke("add_user_correction", { wrong, right });
}

export async function removeUserCorrection(wrong: string): Promise<void> {
  return invoke("remove_user_correction", { wrong });
}

export async function getUserCorrections(): Promise<UserCorrection[]> {
  return invoke("get_user_corrections");
}

export async function learnFromEdit(originalText: string, editedText: string): Promise<[string, string][]> {
  return invoke("learn_from_edit", { originalText, editedText });
}

export async function getUserProfile(): Promise<UserProfile> {
  return invoke("get_user_profile");
}

// ─── Ogrenme Sistemi API ───

export async function getDynamicPromptPreview(language: string): Promise<DynamicPromptPreview> {
  return invoke("get_dynamic_prompt_preview", { language });
}

export async function getNgramStats(): Promise<NgramEntry[]> {
  return invoke("get_ngram_stats");
}

export async function getDomainInfo(): Promise<DomainInfo> {
  return invoke("get_domain_info");
}

export async function resetLearningData(): Promise<void> {
  return invoke("reset_learning_data");
}

export async function exportCorrections(): Promise<string> {
  return invoke("export_corrections");
}

export async function importCorrections(json: string): Promise<number> {
  return invoke("import_corrections", { json });
}
