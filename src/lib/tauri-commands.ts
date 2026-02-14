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
  original_text: string;
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
  deepgram_api_key: string;
  azure_speech_key: string;
  azure_speech_region: string;
  google_cloud_api_key: string;
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
  tts_shortcut: string;
  translate_engine: string;
  deepl_api_key: string;
  translate_target_lang: string;
  translate_source_lang: string;
  translate_auto_detect: boolean;
  translate_shortcut: string;
  ai_provider: string;
  groq_api_key: string;
  gemini_api_key: string;
  ollama_model: string;
  features: {
    voice_commands: boolean;
    sentiment: boolean;
    gamification: boolean;
    templates: boolean;
    three_d_visualizer: boolean;
    live_captions: boolean;
    ambient_theme: boolean;
    meeting_mode: boolean;
    ai_assistant: boolean;
    collaboration: boolean;
    clipboard_manager: boolean;
    mouse_gestures: boolean;
    radial_menu: boolean;
    live_translation: boolean;
  };
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

export async function changeShortcut(shortcut: string, isTts?: boolean): Promise<void> {
  if (isTts) {
    return invoke("change_tts_shortcut", { shortcut });
  }
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
  revert_count: number;
  status: string;
  first_seen: number;
  source: string;
  confidence: number;
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

export async function reportCorrectionRevert(wrong: string, right: string): Promise<void> {
  return invoke("report_correction_revert", { wrong, right });
}

export async function promoteCorrection(wrong: string): Promise<void> {
  return invoke("promote_correction", { wrong });
}

export async function demoteCorrection(wrong: string): Promise<void> {
  return invoke("demote_correction", { wrong });
}

// ─── Ceviri ───

export interface TranslateResponse {
  translated_text: string;
  detected_source_lang: string | null;
  engine: string;
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  engine: string,
  deeplApiKey: string,
): Promise<TranslateResponse> {
  return invoke("translate_text", { text, sourceLang, targetLang, engine, deeplApiKey });
}

export async function changeTranslateShortcut(shortcut: string): Promise<void> {
  return invoke("change_translate_shortcut", { shortcut });
}

// ─── UIA Read-Along ───

export async function uiaInitReadAlong(): Promise<boolean> {
  return invoke("uia_init_read_along");
}

export async function uiaHighlightWord(charOffset: number, charLength: number): Promise<void> {
  return invoke("uia_highlight_word", { charOffset, charLength });
}

export async function uiaStopReadAlong(): Promise<void> {
  return invoke("uia_stop_read_along");
}

// ─── Ses Komutlari ───

export interface VoiceCommandResult {
  cleaned_text: string;
  commands: unknown[];
}

export async function extractVoiceCommands(text: string): Promise<VoiceCommandResult> {
  return invoke("extract_voice_commands", { text });
}

// ─── Duygu Analizi ───

export interface SentimentResult {
  score: number;
  label: string;
  confidence: number;
  dominant_emotion: string;
  word_scores: [string, number][];
}

export async function analyzeTextSentiment(text: string): Promise<SentimentResult> {
  return invoke("analyze_text_sentiment", { text });
}

// ─── Pano Yoneticisi ───

export interface ClipboardEntry {
  text: string;
  timestamp: number;
  pinned: boolean;
}

export async function getClipboardHistory(): Promise<ClipboardEntry[]> {
  return invoke("get_clipboard_history");
}

export async function clearClipboardHistory(): Promise<void> {
  return invoke("clear_clipboard_history");
}

export async function pinClipboardEntry(timestamp: number, pinned: boolean): Promise<void> {
  return invoke("pin_clipboard_entry", { timestamp, pinned });
}

export async function deleteClipboardEntry(timestamp: number): Promise<void> {
  return invoke("delete_clipboard_entry", { timestamp });
}

// ─── Toplanti Modu ───

export interface TranscriptChunk {
  id: number;
  text: string;
  start_time: number;
  end_time: number;
  chapter_id: number;
}

export interface Chapter {
  id: number;
  title: string;
  start_time: number;
  end_time: number;
}

export interface MeetingState {
  is_active: boolean;
  start_time: number;
  total_duration: number;
  chunks: TranscriptChunk[];
  chapters: Chapter[];
}

export async function startMeeting(): Promise<MeetingState> {
  return invoke("start_meeting");
}

export async function stopMeeting(): Promise<MeetingState> {
  return invoke("stop_meeting");
}

export async function addMeetingChunk(text: string, startTime: number, endTime: number): Promise<void> {
  return invoke("add_meeting_chunk", { text, startTime, endTime });
}

export async function getMeetingState(): Promise<MeetingState> {
  return invoke("get_meeting_state");
}

export async function getMeetingTranscript(): Promise<string> {
  return invoke("get_meeting_transcript");
}

// ─── AI Asistan ───

export interface LLMRequest {
  text: string;
  action: string;
  provider: string;
  api_key?: string;
  model?: string;
}

export interface LLMResponse {
  text: string;
  provider: string;
  model: string;
  tokens_used: number;
}

export async function processWithLLM(request: LLMRequest): Promise<LLMResponse> {
  return invoke("process_with_llm", { request });
}

// ─── Peer Discovery ───

export interface PeerInfo {
  name: string;
  address: string;
  port: number;
  peer_id: string;
}

export async function getDiscoveredPeers(): Promise<PeerInfo[]> {
  return invoke("get_discovered_peers");
}

export async function stopPeerService(): Promise<void> {
  return invoke("stop_peer_service");
}

// ─── Canli Ceviri ───

export interface LiveTranslationConfig {
  source_lang: string;
  target_lang: string;
  translate_engine: string;
  deepl_api_key: string;
  audio_source: string;
}

export interface LiveTranslationStatus {
  is_active: boolean;
  source_lang: string;
  target_lang: string;
  device_name: string;
  total_utterances: number;
  uptime_secs: number;
  avg_latency_ms: number;
}

export interface LoopbackDevice {
  id: string;
  name: string;
  is_default: boolean;
}

export async function startLiveTranslation(config: LiveTranslationConfig): Promise<void> {
  return invoke("start_live_translation", { config });
}

export async function stopLiveTranslation(): Promise<void> {
  return invoke("stop_live_translation");
}

export async function getLiveTranslationStatus(): Promise<LiveTranslationStatus> {
  return invoke("get_live_translation_status");
}

export async function setLiveTranslationLanguages(source: string, target: string): Promise<void> {
  return invoke("set_live_translation_languages", { source, target });
}

export async function listLoopbackDevices(): Promise<LoopbackDevice[]> {
  return invoke("list_loopback_devices");
}

export async function submitLiveTranscript(text: string, speaker: string): Promise<void> {
  return invoke("submit_live_transcript", { text, speaker });
}

// ─── Isbirligi HTTP Sunucu ───

export interface CollabServerInfo {
  url: string;
  port: number;
  local_ip: string;
}

export async function startCollabServer(peerId: string): Promise<CollabServerInfo> {
  return invoke("start_collab_server", { peerId });
}

export async function stopCollabServer(): Promise<void> {
  return invoke("stop_collab_server");
}

export async function getCollabServerInfo(): Promise<CollabServerInfo | null> {
  return invoke("get_collab_server_info");
}
