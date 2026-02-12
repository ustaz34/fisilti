import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { OverlayBar } from "./components/OverlayBar";
import { useSettingsStore, type AppSettings } from "./stores/settingsStore";
import { useRecordingStore } from "./stores/recordingStore";
import { getAudioLevels, getSettings } from "./lib/tauri-commands";
import { useTranscription } from "./hooks/useTranscription";
import { updateWakeWord } from "./lib/wakeWordListener";
import { listenThemeChanges } from "./lib/themeEngine";

function App() {
  const { settings, updateSettings } = useSettingsStore();
  const { isRecording, setAudioLevel } = useRecordingStore();
  const levelPollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const { doStart, doStop, startVoiceActivation, stopVoiceActivation } =
    useTranscription();

  // Tema degisikliklerini dinle (ayarlar penceresinden)
  useEffect(() => {
    const unlisten = listenThemeChanges();
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Backend'den ayarlari yukle
  useEffect(() => {
    getSettings()
      .then((saved) => {
        updateSettings({
          selectedModel: saved.selected_model,
          selectedDevice: saved.selected_device ?? null,
          theme: saved.theme as "dark" | "light",
          shortcut: saved.shortcut,
          recordingMode: saved.recording_mode as "button" | "auto" | "shortcut",
          vadThreshold: saved.vad_threshold,
          autoPaste: saved.auto_paste,
          language: saved.language,
          transcriptionEngine:
            (saved.transcription_engine as "whisper" | "web" | "deepgram" | "azure" | "google-cloud") || "web",
          deepgramApiKey: saved.deepgram_api_key ?? "",
          azureSpeechKey: saved.azure_speech_key ?? "",
          azureSpeechRegion: saved.azure_speech_region ?? "",
          googleCloudApiKey: saved.google_cloud_api_key ?? "",
          voiceActivation: saved.voice_activation ?? false,
          wakeWord: saved.wake_word ?? "fısıltı",
          soundEnabled: saved.sound_enabled ?? true,
          autoStart: saved.auto_start ?? false,
          silenceTimeout: saved.silence_timeout ?? 4,
          maxRecordDuration: saved.max_record_duration ?? 60,
          turkishCorrections: saved.turkish_corrections ?? true,
          hallucinationFilter: saved.hallucination_filter ?? true,
          overlayFollowCursor: saved.overlay_follow_cursor ?? true,
          autoPunctuation: saved.auto_punctuation ?? true,
          autoCapitalization: saved.auto_capitalization ?? true,
          preserveEnglishWords: saved.preserve_english_words ?? true,
          autoComma: saved.auto_comma ?? true,
          paragraphBreak: saved.paragraph_break ?? false,
          notifications: saved.notifications ?? true,
          logLevel: saved.log_level ?? "info",
        });
      })
      .catch(console.error);
  }, []);

  // Ayarlar penceresinden gelen degisiklikleri dinle
  useEffect(() => {
    const unlisten = listen<AppSettings>("settings-changed", (event) => {
      updateSettings(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [updateSettings]);

  // Sesli aktivasyonu baslat/durdur (ayar veya dil degistiginde)
  useEffect(() => {
    if (settings.voiceActivation) {
      // Dil degistiginde listener'i yeniden baslat (eski dilde dinlemeye devam etmesin)
      stopVoiceActivation();
      const timer = setTimeout(() => {
        startVoiceActivation();
      }, 200);
      return () => clearTimeout(timer);
    } else {
      stopVoiceActivation();
    }
  }, [settings.voiceActivation, settings.language, startVoiceActivation, stopVoiceActivation]);

  // Wake word degisince listener'i yeniden baslatma - sadece varyantlari guncelle
  useEffect(() => {
    updateWakeWord(settings.wakeWord);
  }, [settings.wakeWord]);

  // Push-to-talk: basili tut -> kayit, birak -> durdur
  useEffect(() => {
    let keyDownTime = 0;
    let minDurationTimer: ReturnType<typeof setTimeout> | undefined;

    const unlistenDown = listen("shortcut-key-down", () => {
      if (minDurationTimer) {
        clearTimeout(minDurationTimer);
        minDurationTimer = undefined;
      }
      keyDownTime = Date.now();
      doStart();
    });

    const unlistenUp = listen("shortcut-key-up", () => {
      const elapsed = Date.now() - keyDownTime;
      const MIN_DURATION_MS = 200;
      if (elapsed < MIN_DURATION_MS) {
        minDurationTimer = setTimeout(() => {
          doStop();
          minDurationTimer = undefined;
        }, MIN_DURATION_MS - elapsed);
      } else {
        doStop();
      }
    });

    return () => {
      unlistenDown.then((fn) => fn());
      unlistenUp.then((fn) => fn());
      if (minDurationTimer) clearTimeout(minDurationTimer);
    };
  }, [doStart, doStop]);

  // Kayit sirasinda ses seviyesini sorgula (sadece whisper modunda)
  useEffect(() => {
    if (isRecording) {
      const engine = useSettingsStore.getState().settings.transcriptionEngine;
      if (engine === "whisper") {
        levelPollRef.current = setInterval(async () => {
          try {
            const level = await getAudioLevels();
            setAudioLevel(level);
          } catch {
            // ignore
          }
        }, 50);
      }
    } else {
      setAudioLevel(0);
    }
    return () => {
      if (levelPollRef.current) clearInterval(levelPollRef.current);
    };
  }, [isRecording, setAudioLevel]);

  return <OverlayBar />;
}

export default App;
