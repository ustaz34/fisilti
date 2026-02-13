import { create } from "zustand";
import type { EdgeVoice } from "../lib/edgeTTSService";

export type TTSStatus = "idle" | "loading" | "speaking" | "paused";
export type TTSEngine = "browser" | "edge";
export type TTSLanguage = "tr" | "ar" | "en" | "ru";

export const TTS_LANGUAGES: { id: TTSLanguage; name: string; flag: string; testText: string }[] = [
  { id: "tr", name: "Türkçe", flag: "🇹🇷", testText: "Merhaba, bu bir ses testidir." },
  { id: "en", name: "English", flag: "🇬🇧", testText: "Hello, this is a voice test." },
  { id: "ar", name: "العربية", flag: "🇸🇦", testText: "مرحبا، هذا اختبار صوتي." },
  { id: "ru", name: "Русский", flag: "🇷🇺", testText: "Привет, это тест голоса." },
];

export type ReadAlongMode = "off" | "source" | "overlay" | "both";
export type ReadAlongGranularity = "word" | "sentence";

export interface TTSSettings {
  engine: TTSEngine;
  language: TTSLanguage;
  selectedVoice: string;
  rate: number;
  pitch: number;
  volume: number;
  readAlongMode: ReadAlongMode;
  readAlongGranularity: ReadAlongGranularity;
}

export interface TTSVoice {
  name: string;
  lang: string;
  voiceURI: string;
}

interface TTSState {
  status: TTSStatus;
  currentText: string;
  previewText: string;
  charIndex: number;
  totalChars: number;
  settings: TTSSettings;
  // Browser (speechSynthesis) sesleri
  voices: TTSVoice[];
  turkishVoices: TTSVoice[];
  // Edge TTS sesleri
  edgeVoices: EdgeVoice[];
  edgeTurkishVoices: EdgeVoice[];
  // Read-along takip
  currentWord: string;
  currentWordOffset: number;
  currentWordLength: number;
  readAlongSupported: boolean;
  setStatus: (status: TTSStatus) => void;
  setCurrentText: (text: string) => void;
  setPreviewText: (text: string) => void;
  setProgress: (charIndex: number, totalChars: number) => void;
  updateTTSSettings: (partial: Partial<TTSSettings>) => void;
  setVoices: (voices: TTSVoice[], turkishVoices: TTSVoice[]) => void;
  setEdgeVoices: (voices: EdgeVoice[], turkishVoices: EdgeVoice[]) => void;
  setCurrentWord: (word: string, offset: number, length: number) => void;
  setReadAlongSupported: (supported: boolean) => void;
  reset: () => void;
}

const defaultTTSSettings: TTSSettings = {
  engine: "edge",
  language: "tr",
  selectedVoice: "",
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  readAlongMode: "source",
  readAlongGranularity: "word",
};

export const useTTSStore = create<TTSState>((set) => ({
  status: "idle",
  currentText: "",
  previewText: "",
  charIndex: 0,
  totalChars: 0,
  settings: defaultTTSSettings,
  voices: [],
  turkishVoices: [],
  edgeVoices: [],
  edgeTurkishVoices: [],
  currentWord: "",
  currentWordOffset: 0,
  currentWordLength: 0,
  readAlongSupported: false,
  setStatus: (status) => set({ status }),
  setCurrentText: (text) => set({ currentText: text, previewText: text.length > 60 ? text.slice(0, 57) + "..." : text, totalChars: text.length, charIndex: 0 }),
  setPreviewText: (text) => set({ previewText: text }),
  setProgress: (charIndex, totalChars) => set({ charIndex, totalChars }),
  updateTTSSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
    })),
  setVoices: (voices, turkishVoices) => set({ voices, turkishVoices }),
  setEdgeVoices: (voices, turkishVoices) => set({ edgeVoices: voices, edgeTurkishVoices: turkishVoices }),
  setCurrentWord: (word, offset, length) => set({ currentWord: word, currentWordOffset: offset, currentWordLength: length }),
  setReadAlongSupported: (supported) => set({ readAlongSupported: supported }),
  reset: () => set({ status: "idle", currentText: "", previewText: "", charIndex: 0, totalChars: 0, currentWord: "", currentWordOffset: 0, currentWordLength: 0 }),
}));

// Kalicilik: tts-settings.json'a kaydet/yukle
let settingsLoaded = false;

export async function loadTTSSettings() {
  if (settingsLoaded) return;
  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    const store = new LazyStore("tts-settings.json");
    const engine = await store.get<string>("engine");
    const language = await store.get<string>("language");
    const voice = await store.get<string>("selectedVoice");
    const rate = await store.get<number>("rate");
    const pitch = await store.get<number>("pitch");
    const volume = await store.get<number>("volume");
    const readAlongMode = await store.get<string>("readAlongMode");
    const readAlongGranularity = await store.get<string>("readAlongGranularity");
    const partial: Partial<TTSSettings> = {};
    if (engine === "browser" || engine === "edge") partial.engine = engine;
    if (language === "tr" || language === "ar" || language === "en" || language === "ru") partial.language = language;
    if (voice) partial.selectedVoice = voice;
    if (rate != null) partial.rate = rate;
    if (pitch != null) partial.pitch = pitch;
    if (volume != null) partial.volume = volume;
    if (readAlongMode === "off" || readAlongMode === "source" || readAlongMode === "overlay" || readAlongMode === "both") partial.readAlongMode = readAlongMode;
    if (readAlongGranularity === "word" || readAlongGranularity === "sentence") partial.readAlongGranularity = readAlongGranularity;
    if (Object.keys(partial).length > 0) {
      useTTSStore.getState().updateTTSSettings(partial);
    }
    settingsLoaded = true;
  } catch (e) {
    console.error("TTS ayarlari yuklenemedi:", e);
  }
}

export async function saveTTSSettings() {
  try {
    const { LazyStore } = await import("@tauri-apps/plugin-store");
    const store = new LazyStore("tts-settings.json");
    const s = useTTSStore.getState().settings;
    await store.set("engine", s.engine);
    await store.set("language", s.language);
    await store.set("selectedVoice", s.selectedVoice);
    await store.set("rate", s.rate);
    await store.set("pitch", s.pitch);
    await store.set("volume", s.volume);
    await store.set("readAlongMode", s.readAlongMode);
    await store.set("readAlongGranularity", s.readAlongGranularity);
    await store.save();
  } catch (e) {
    console.error("TTS ayarlari kaydedilemedi:", e);
  }
}
