import { create } from "zustand";

interface RecordingState {
  isRecording: boolean;
  duration: number;
  audioLevel: number;
  audioData: number[] | null;
  setRecording: (recording: boolean) => void;
  setDuration: (duration: number) => void;
  setAudioLevel: (level: number) => void;
  setAudioData: (data: number[] | null) => void;
  reset: () => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  isRecording: false,
  duration: 0,
  audioLevel: 0,
  audioData: null,
  setRecording: (recording) => set({ isRecording: recording }),
  setDuration: (duration) => set({ duration }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  setAudioData: (data) => set({ audioData: data }),
  reset: () =>
    set({ isRecording: false, duration: 0, audioLevel: 0, audioData: null }),
}));
