import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { learnFromEdit } from "../lib/tauri-commands";

export interface TranscriptionEntry {
  id: string;
  text: string;
  timestamp: number;
  durationMs: number;
  engine: "web" | "whisper";
  language: string;
  modelId: string;
  userEdited?: boolean;
  editedText?: string;
  originalText?: string;
  confidence?: number;
}

interface HistoryEntryBackend {
  id: string;
  text: string;
  timestamp: number;
  duration_ms: number;
  engine: string;
  language: string;
  model_id: string;
}

interface TranscriptionState {
  currentText: string;
  isTranscribing: boolean;
  history: TranscriptionEntry[];
  historyLoaded: boolean;
  setCurrentText: (text: string) => void;
  setTranscribing: (transcribing: boolean) => void;
  addToHistory: (entry: TranscriptionEntry) => void;
  editEntry: (id: string, newText: string) => void;
  clearHistory: () => void;
  clearCurrentText: () => void;
  loadHistory: () => Promise<void>;
}

export const useTranscriptionStore = create<TranscriptionState>((set) => ({
  currentText: "",
  isTranscribing: false,
  history: [],
  historyLoaded: false,
  setCurrentText: (text) => set({ currentText: text }),
  setTranscribing: (transcribing) => set({ isTranscribing: transcribing }),
  addToHistory: (entry) => {
    set((state) => ({ history: [entry, ...state.history] }));
    // Backend'e kaydet
    const backendEntry: HistoryEntryBackend = {
      id: entry.id,
      text: entry.text,
      timestamp: entry.timestamp,
      duration_ms: entry.durationMs,
      engine: entry.engine,
      language: entry.language,
      model_id: entry.modelId,
    };
    invoke("save_history_entry", { entry: backendEntry })
      .catch((err) => {
        console.error("Gecmis kaydedilemedi:", err);
      });
  },
  editEntry: (id, newText) => {
    set((state) => ({
      history: state.history.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              originalText: entry.originalText || entry.text,
              text: newText,
              editedText: newText,
              userEdited: true,
            }
          : entry,
      ),
    }));
    // Backend'e ogrenme gonder
    const entry = useTranscriptionStore.getState().history.find((e) => e.id === id);
    if (entry) {
      const original = entry.originalText || entry.text;
      learnFromEdit(original, newText).catch((err) => {
        console.error("Ogrenme gonderilemedi:", err);
      });
    }
  },
  clearHistory: () => {
    set({ history: [] });
    invoke("clear_history").catch((err) => {
      console.error("Gecmis temizlenemedi:", err);
    });
  },
  clearCurrentText: () => set({ currentText: "" }),
  loadHistory: async () => {
    try {
      const entries: HistoryEntryBackend[] = await invoke("get_history");
      const history: TranscriptionEntry[] = entries.map((e) => ({
        id: e.id,
        text: e.text,
        timestamp: e.timestamp,
        durationMs: e.duration_ms,
        engine: (e.engine as "web" | "whisper") || "web",
        language: e.language || "tr",
        modelId: e.model_id || "web-speech",
      }));
      set({ history, historyLoaded: true });
    } catch (err) {
      console.error("Gecmis yuklenemedi:", err);
      set({ historyLoaded: true });
    }
  },
}));
