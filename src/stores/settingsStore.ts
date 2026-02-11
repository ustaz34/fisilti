import { create } from "zustand";

export interface AppSettings {
  selectedModel: string;
  selectedDevice: string | null;
  theme: "dark" | "light";
  shortcut: string;
  recordingMode: "button" | "auto" | "shortcut";
  vadThreshold: number;
  autoPaste: boolean;
  language: string;
  transcriptionEngine: "whisper" | "web";
  voiceActivation: boolean;
  wakeWord: string;
  soundEnabled: boolean;
  autoStart: boolean;
  silenceTimeout: number;
  maxRecordDuration: number;
  turkishCorrections: boolean;
  hallucinationFilter: boolean;
  overlayFollowCursor: boolean;
  autoPunctuation: boolean;
  autoCapitalization: boolean;
  preserveEnglishWords: boolean;
  autoComma: boolean;
  paragraphBreak: boolean;
  notifications: boolean;
  logLevel: string;
}

export type WakeWordStatus =
  | "inactive"
  | "requesting_mic"
  | "starting"
  | "listening"
  | "error"
  | "detected"
  | "no_support";

interface SettingsState {
  settings: AppSettings;
  showSettings: boolean;
  wakeWordStatus: WakeWordStatus;
  wakeWordError: string | null;
  updateSettings: (partial: Partial<AppSettings>) => void;
  setShowSettings: (show: boolean) => void;
  setWakeWordStatus: (status: WakeWordStatus, error?: string | null) => void;
}

const defaultSettings: AppSettings = {
  selectedModel: "large-v3-turbo-q5",
  selectedDevice: null,
  theme: "dark",
  shortcut: "Ctrl+Shift+Space",
  recordingMode: "button",
  vadThreshold: 0.3,
  autoPaste: true,
  language: "tr",
  transcriptionEngine: "web",
  voiceActivation: false,
  wakeWord: "fısıltı",
  soundEnabled: true,
  autoStart: false,
  silenceTimeout: 4,
  maxRecordDuration: 60,
  turkishCorrections: true,
  hallucinationFilter: true,
  overlayFollowCursor: true,
  autoPunctuation: true,
  autoCapitalization: true,
  preserveEnglishWords: true,
  autoComma: true,
  paragraphBreak: false,
  notifications: true,
  logLevel: "info",
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  showSettings: false,
  wakeWordStatus: "inactive",
  wakeWordError: null,
  updateSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
    })),
  setShowSettings: (show) => set({ showSettings: show }),
  setWakeWordStatus: (status, error) =>
    set({ wakeWordStatus: status, wakeWordError: error ?? null }),
}));
