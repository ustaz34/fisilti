import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { learnFromEdit, reportCorrectionRevert } from "../lib/tauri-commands";

export interface TranscriptionEntry {
  id: string;
  text: string;
  timestamp: number;
  durationMs: number;
  engine: "web" | "whisper" | "deepgram" | "azure" | "google-cloud";
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
    // Revert detection: pipeline degistirmis ama kullanici geri almissa
    const beforeEdit = useTranscriptionStore.getState().history.find((e) => e.id === id);
    if (beforeEdit) {
      const originalRaw = beforeEdit.originalText; // ham motor ciktisi
      const pipelineResult = beforeEdit.text; // pipeline sonrasi
      // Pipeline degistirmis VE kullanici orijinale geri donmus → revert
      if (originalRaw && pipelineResult !== originalRaw) {
        // Pipeline'in degistirdigi kelimeleri bul, kullanicinin geri aldiklarini tespit et
        const pipelineWords = pipelineResult.toLowerCase().split(/\s+/);
        const newWords = newText.toLowerCase().split(/\s+/);
        const originalWords = originalRaw.toLowerCase().split(/\s+/);
        // Pipeline'in degistirdigi ama kullanicinin geri aldigi kelimeler
        for (let i = 0; i < Math.min(pipelineWords.length, newWords.length, originalWords.length); i++) {
          if (pipelineWords[i] !== originalWords[i] && newWords[i] === originalWords[i]) {
            // Kullanici pipeline duzeltmesini geri aldi
            reportCorrectionRevert(originalWords[i], pipelineWords[i]).catch((err) => {
              console.error("Revert bildirimi gonderilemedi:", err);
            });
          }
        }
      }
    }

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
        engine: (e.engine as "web" | "whisper" | "deepgram" | "azure" | "google-cloud") || "web",
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
