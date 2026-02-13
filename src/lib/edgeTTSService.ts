/**
 * Edge TTS Service — Rust backend uzerinden Microsoft Edge neural ses sentezi
 * Tauri komutlari ile calisir: edge_tts_get_voices, edge_tts_synthesize
 */

import { invoke } from "@tauri-apps/api/core";

export interface EdgeVoice {
  Name: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  FriendlyName: string;
}

let cachedVoices: EdgeVoice[] | null = null;

export async function getEdgeVoices(): Promise<EdgeVoice[]> {
  if (cachedVoices) return cachedVoices;
  const voices = await invoke<EdgeVoice[]>("edge_tts_get_voices");
  cachedVoices = voices;
  return voices;
}

export async function getEdgeTurkishVoices(): Promise<EdgeVoice[]> {
  const voices = await getEdgeVoices();
  return voices.filter((v) => v.Locale.startsWith("tr-"));
}

/**
 * Edge TTS ile metni seslendirir, MP3 Blob dondurur
 * Rust backend WebSocket baglantisini yapar, base64 encoded MP3 dondurur
 */
export interface WordBoundary {
  audio_offset_ticks: number;
  duration_ticks: number;
  text: string;
  text_length: number;
  text_offset: number;
}

interface EdgeTTSSynthResult {
  audio_base64: string;
  word_boundaries: WordBoundary[];
}

export async function synthesizeEdgeTTS(
  text: string,
  voice: string,
  rate: number,
  pitch: number,
  volume: number
): Promise<Blob> {
  const base64Audio = await invoke<string>("edge_tts_synthesize", {
    text,
    voice,
    rate,
    pitch,
    volume,
  });

  // Base64 → Blob
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: "audio/mpeg" });
}

/**
 * Edge TTS ile metni seslendirir, MP3 Blob + word boundary dizisi dondurur
 */
export async function synthesizeEdgeTTSWithBoundaries(
  text: string,
  voice: string,
  rate: number,
  pitch: number,
  volume: number
): Promise<{ blob: Blob; wordBoundaries: WordBoundary[] }> {
  const result = await invoke<EdgeTTSSynthResult>("edge_tts_synthesize_with_boundaries", {
    text,
    voice,
    rate,
    pitch,
    volume,
  });

  // Base64 → Blob
  const binaryString = atob(result.audio_base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "audio/mpeg" });

  return { blob, wordBoundaries: result.word_boundaries };
}
