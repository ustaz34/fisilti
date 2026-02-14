import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { OverlayBar } from "./components/OverlayBar";
import { useSettingsStore, type AppSettings } from "./stores/settingsStore";
import { useRecordingStore } from "./stores/recordingStore";
import { useTTSStore } from "./stores/ttsStore";
import { useGamificationStore } from "./stores/gamificationStore";
import { getAudioLevels, getSettings } from "./lib/tauri-commands";
import { useTranscription } from "./hooks/useTranscription";
import { updateWakeWord } from "./lib/wakeWordListener";
import { listenThemeChanges } from "./lib/themeEngine";
import { useTemplateVoiceTrigger } from "./hooks/useTemplateVoiceTrigger";
import {
  startMeetingRecorder,
  stopMeetingRecorder,
  MTG_EVENT,
} from "./lib/meetingRecorder";

function App() {
  const { settings, updateSettings } = useSettingsStore();
  const { isRecording, setAudioLevel } = useRecordingStore();
  const levelPollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const { doStart, doStop, startVoiceActivation, stopVoiceActivation } =
    useTranscription();

  // Sablon sesli tetikleyici — bagimsiz sistem, transkripsiyon pipeline'ina dokunmaz
  useTemplateVoiceTrigger();

  // Gamification state'ini overlay baslatildiginda yukle
  useEffect(() => {
    useGamificationStore.getState().loadState();
  }, []);

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
          ttsShortcut: saved.tts_shortcut ?? "Ctrl+Shift+R",
          features: saved.features ? {
            voiceCommands: saved.features.voice_commands ?? true,
            sentiment: saved.features.sentiment ?? false,
            gamification: saved.features.gamification ?? true,
            templates: saved.features.templates ?? true,
            threeDVisualizer: saved.features.three_d_visualizer ?? false,
            liveCaptions: saved.features.live_captions ?? true,
            ambientTheme: saved.features.ambient_theme ?? false,
            meetingMode: saved.features.meeting_mode ?? true,
            aiAssistant: saved.features.ai_assistant ?? false,
            collaboration: saved.features.collaboration ?? true,
            clipboardManager: saved.features.clipboard_manager ?? true,
            mouseGestures: saved.features.mouse_gestures ?? false,
            radialMenu: saved.features.radial_menu ?? false,
            liveTranslation: saved.features.live_translation ?? false,
          } : undefined,
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
      }, 500); // 200ms -> 500ms: SpeechRecognition abort async — eski oturumun tamamen bitmesini bekle
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

  // TTS: tts-status-changed event'ini dinle (main window'dan senkronize)
  useEffect(() => {
    const unlisten = listen<{ status: string; text?: string; charIndex?: number; totalChars?: number; readAlongMode?: string }>("tts-status-changed", (event) => {
      const { status, text, charIndex, totalChars, readAlongMode } = event.payload;
      const store = useTTSStore.getState();
      store.setStatus(status as "idle" | "loading" | "speaking" | "paused");
      if (text !== undefined) store.setPreviewText(text);
      if (charIndex !== undefined && totalChars !== undefined) store.setProgress(charIndex, totalChars);
      if (readAlongMode) store.updateTTSSettings({ readAlongMode: readAlongMode as "off" | "source" | "overlay" | "both" });
      // idle'da karaoke state'ini temizle
      if (status === "idle") {
        store.setCurrentWord("", 0, 0);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Overlay karaoke: kelime pozisyonu ve metin event'lerini dinle
  useEffect(() => {
    const unlisten1 = listen<{ text: string }>("tts-text-set", (event) => {
      useTTSStore.getState().setCurrentText(event.payload.text);
    });
    const unlisten2 = listen<{ word: string; offset: number; length: number }>("tts-word-update", (event) => {
      const { word, offset, length } = event.payload;
      useTTSStore.getState().setCurrentWord(word, offset, length);
    });
    return () => {
      unlisten1.then((fn) => fn());
      unlisten2.then((fn) => fn());
    };
  }, []);

  // ─── Toplanti modu: main pencereden gelen start/stop komutlarini dinle ───
  // meetingRecorder OVERLAY penceresinde calisir (SpeechRecognition burada garanti).
  // Main pencere (SettingsApp/MeetingPanel) event ile komutu gonderir.
  useEffect(() => {
    const unlistenStart = listen<{ language: string }>(MTG_EVENT.CMD_START, async (event) => {
      console.log("[App] Meeting start komutu alindi, dil:", event.payload.language);

      // 1) Mevcut kaydi/sesli aktivasyonu tamamen durdur
      stopVoiceActivation();
      doStop(); // Overlay'de devam eden kayit varsa durdur

      // 2) Eski SpeechRecognition'in tam kapanmasi icin bekle (kritik!)
      await new Promise((r) => setTimeout(r, 800));

      // 3) Meeting recorder'i baslat
      console.log("[App] Meeting recorder baslatiliyor...");
      await startMeetingRecorder(event.payload.language);
    });

    const unlistenStop = listen(MTG_EVENT.CMD_STOP, () => {
      console.log("[App] Meeting stop komutu alindi");
      stopMeetingRecorder();
      // Sesli aktivasyonu tekrar baslat (ayar aciksa)
      const va = useSettingsStore.getState().settings.voiceActivation;
      if (va) {
        setTimeout(() => startVoiceActivation(), 500);
      }
    });

    return () => {
      unlistenStart.then((fn) => fn());
      unlistenStop.then((fn) => fn());
    };
  }, [stopVoiceActivation, startVoiceActivation, doStop]);

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
        }, 100);
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
