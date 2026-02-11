import { useCallback } from "react";
import { useRecordingStore } from "../stores/recordingStore";
import { useTranscriptionStore } from "../stores/transcriptionStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  startRecording,
  stopRecording,
  transcribeAudio,
  pasteToActiveApp,
  getSettings,
  processText,
  getAudioLevels,
} from "../lib/tauri-commands";
import {
  startWebSpeech,
  stopWebSpeech,
  getFinalTranscript,
  isWebSpeechSupported,
  getResultConfidence,
} from "../lib/webSpeechService";
import {
  startWakeWordListener,
  stopWakeWordListener,
} from "../lib/wakeWordListener";
import {
  playActivationSound,
  playDeactivationSound,
  playErrorSound,
} from "../lib/soundEffects";
import {
  startBrowserAudioMonitor,
  stopBrowserAudioMonitor,
  getBrowserAudioLevel,
} from "../lib/browserAudioMonitor";

// ---- Modul seviyesi paylasilan durum ----
let isActive = false;
let recordingStartTime = 0;
let durationTimer: ReturnType<typeof setInterval> | undefined;
let maxDurationTimer: ReturnType<typeof setTimeout> | undefined;
let silenceMonitorTimer: ReturnType<typeof setInterval> | undefined;
let silenceStartTime = 0;
let hasDetectedSpeech = false;

function clearDurationTimer() {
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = undefined;
  }
}

function clearMaxDurationTimer() {
  if (maxDurationTimer) {
    clearTimeout(maxDurationTimer);
    maxDurationTimer = undefined;
  }
}

function clearSilenceMonitor() {
  if (silenceMonitorTimer) {
    clearInterval(silenceMonitorTimer);
    silenceMonitorTimer = undefined;
  }
  silenceStartTime = 0;
  hasDetectedSpeech = false;
  // Browser audio monitor'u da temizle (Web Speech icin)
  stopBrowserAudioMonitor().catch(() => {});
}

/**
 * Whisper icin sessizlik izleme
 * Backend'den ses seviyesini pollla, sessizlik suresi dolunca kaydi durdur
 */
function startSilenceMonitor() {
  clearSilenceMonitor();
  const settings = useSettingsStore.getState().settings;
  // RMS degerleri cpal'de tipik konusma icin 0.01-0.10 araliginda.
  // vadThreshold (0-1) UI'da yuzde olarak gosteriliyor, ama RMS icin
  // cok yuksek. Olcekle: 0.3 -> 0.03 gibi makul bir esige donustur.
  const threshold = Math.max((settings.vadThreshold || 0.3) * 0.1, 0.005);
  const silenceTimeoutMs = getSilenceTimeoutMs();
  const minSpeechBeforeStop = 1500;
  const noSpeechTimeoutMs = 10000;

  silenceMonitorTimer = setInterval(async () => {
    if (!isActive) {
      clearSilenceMonitor();
      return;
    }

    try {
      const level = await getAudioLevels();

      if (level >= threshold) {
        silenceStartTime = 0;
        hasDetectedSpeech = true;
      } else if (hasDetectedSpeech) {
        if (silenceStartTime === 0) {
          silenceStartTime = Date.now();
        }
        const elapsed = Date.now() - recordingStartTime;
        const silenceDuration = Date.now() - silenceStartTime;

        if (elapsed > minSpeechBeforeStop && silenceDuration >= silenceTimeoutMs) {
          clearSilenceMonitor();
          doForceStop();
        }
      } else {
        const elapsed = Date.now() - recordingStartTime;
        if (elapsed > noSpeechTimeoutMs) {
          clearSilenceMonitor();
          doForceStop();
        }
      }
    } catch {
      // Ses seviyesi okunamazsa devam et
    }
  }, 200);
}

/**
 * Web Speech (Google) icin tarayici tarafli sessizlik izleme.
 * Browser AudioContext + AnalyserNode ile ses seviyesini olcer,
 * VAD esigine gore sessizlik algiliyor.
 */
async function startBrowserSilenceMonitor() {
  clearSilenceMonitor();
  const settings = useSettingsStore.getState().settings;
  const threshold = Math.max((settings.vadThreshold || 0.3) * 0.1, 0.005);
  const silenceTimeoutMs = getSilenceTimeoutMs();
  const minSpeechBeforeStop = 1500;
  const noSpeechTimeoutMs = 10000;

  // Tarayici ses izlemeyi baslat
  const deviceId = settings.selectedDevice ?? undefined;
  await startBrowserAudioMonitor(deviceId);

  silenceMonitorTimer = setInterval(() => {
    if (!isActive) {
      clearSilenceMonitor();
      return;
    }

    const level = getBrowserAudioLevel();

    if (level >= threshold) {
      silenceStartTime = 0;
      hasDetectedSpeech = true;
    } else if (hasDetectedSpeech) {
      if (silenceStartTime === 0) {
        silenceStartTime = Date.now();
      }
      const elapsed = Date.now() - recordingStartTime;
      const silenceDuration = Date.now() - silenceStartTime;

      if (elapsed > minSpeechBeforeStop && silenceDuration >= silenceTimeoutMs) {
        clearSilenceMonitor();
        doForceStop();
      }
    } else {
      const elapsed = Date.now() - recordingStartTime;
      if (elapsed > noSpeechTimeoutMs) {
        clearSilenceMonitor();
        doForceStop();
      }
    }
  }, 200);
}

function startDurationCounter() {
  clearDurationTimer();
  recordingStartTime = Date.now();
  durationTimer = setInterval(() => {
    if (!useRecordingStore.getState().isRecording) {
      clearDurationTimer();
      return;
    }
    useRecordingStore
      .getState()
      .setDuration(Math.floor((Date.now() - recordingStartTime) / 1000));
  }, 1000);
}

function getSilenceTimeoutMs(): number {
  const timeout = useSettingsStore.getState().settings.silenceTimeout;
  return (timeout || 4) * 1000;
}

function getMaxRecordDurationMs(): number {
  const duration = useSettingsStore.getState().settings.maxRecordDuration;
  if (!duration || duration === 0) return 0;
  return duration * 1000;
}

async function finishWithText(text: string, engineOverride?: "web" | "whisper") {
  if (!text) {
    useTranscriptionStore.getState().setCurrentText("");
    return;
  }

  const settings = useSettingsStore.getState().settings;
  const durationMs = Date.now() - recordingStartTime;
  const engine = engineOverride || settings.transcriptionEngine;

  // Web Speech sonuclarini da backend'de isle (noktalama, duzeltme vs.)
  let processedText = text;
  let originalText: string | undefined;
  if (engine === "web") {
    try {
      processedText = await processText(text);
      // Web Speech ham metin != islenmis metin ise originalText olarak kaydet
      if (processedText !== text) {
        originalText = text;
      }
    } catch {
      // hata durumunda orijinal metni kullan
    }
  }

  useTranscriptionStore.getState().setCurrentText(processedText);
  useTranscriptionStore.getState().addToHistory({
    id: Date.now().toString(),
    text: processedText,
    originalText,
    timestamp: Date.now(),
    durationMs,
    engine: engine as "web" | "whisper",
    language: settings.language,
    modelId: engine === "web" ? "web-speech" : settings.selectedModel,
    confidence: engine === "web" ? getResultConfidence() : undefined,
  });

  if (settings.autoPaste) {
    try {
      await pasteToActiveApp(processedText);
    } catch {
      // sessizce devam
    }
  }
}

function wakeWordStatusCallback(status: import("../stores/settingsStore").WakeWordStatus, error?: string) {
  useSettingsStore.getState().setWakeWordStatus(status, error);
}

/**
 * Sesli aktivasyon bittikten sonra wake word listener'i yeniden baslat
 */
function restartWakeWordIfEnabled() {
  const settings = useSettingsStore.getState().settings;
  if (settings.voiceActivation) {
    setTimeout(() => {
      startWakeWordListener("tr", handleWakeWord, settings.wakeWord, wakeWordStatusCallback);
    }, 300); // Kisa bekleme, SpeechRecognition cakismasi onlemi
  }
}

/** Maks kayit suresi veya sessizlik dolunca kaydi durdur */
function doForceStop() {
  if (!isActive) return;
  const engine = useSettingsStore.getState().settings.transcriptionEngine;
  isActive = false;
  clearDurationTimer();
  clearMaxDurationTimer();
  clearSilenceMonitor();

  if (engine === "web") {
    stopWebSpeech().then((text) => {
      useRecordingStore.getState().setRecording(false);
      if (text) playDeactivationSound();
      finishWithText(text, "web").then(() => {
        restartWakeWordIfEnabled();
      });
    });
  } else {
    stopRecording().then(async (audioData) => {
      useRecordingStore.getState().setRecording(false);
      useRecordingStore.getState().setAudioData(audioData);
      useTranscriptionStore.getState().setTranscribing(true);
      useTranscriptionStore.getState().setCurrentText("Donusturuluyor...");
      try {
        const result = await transcribeAudio(
          audioData,
          useSettingsStore.getState().settings.selectedModel,
        );
        if (result.text) {
          playDeactivationSound();
          await finishWithText(result.text, "whisper");
        } else {
          useTranscriptionStore.getState().setCurrentText("");
        }
      } catch (err) {
        playErrorSound();
        useTranscriptionStore.getState().setCurrentText(`Hata: ${err}`);
      } finally {
        useTranscriptionStore.getState().setTranscribing(false);
      }
      restartWakeWordIfEnabled();
    }).catch((err) => {
      playErrorSound();
      useTranscriptionStore.getState().setCurrentText(`Kayit durdurma hatasi: ${err}`);
      useRecordingStore.getState().setRecording(false);
      restartWakeWordIfEnabled();
    });
  }
}

function startMaxDurationTimer() {
  clearMaxDurationTimer();
  const maxMs = getMaxRecordDurationMs();
  if (maxMs <= 0) return;
  maxDurationTimer = setTimeout(() => {
    doForceStop();
  }, maxMs);
}

/**
 * Wake word tespit edildiginde cagrilir
 */
function handleWakeWord() {
  if (isActive) return;
  stopWakeWordListener();

  const settings = useSettingsStore.getState().settings;
  const engine = settings.transcriptionEngine;

  useRecordingStore.getState().setDuration(0);
  useTranscriptionStore.getState().setCurrentText("");

  isActive = true;
  useRecordingStore.getState().setRecording(true);
  startDurationCounter();
  startMaxDurationTimer();
  playActivationSound();

  if (engine === "web") {
    if (!isWebSpeechSupported()) {
      isActive = false;
      useRecordingStore.getState().setRecording(false);
      clearDurationTimer();
      clearMaxDurationTimer();
      playErrorSound();
      restartWakeWordIfEnabled();
      return;
    }

    const lang = settings.language;
    // Kisa gecikme: tarayicinin onceki SpeechRecognition'i serbest birakmasi icin
    setTimeout(() => {
      startWebSpeech(
        lang,
        {
          onInterimResult: (text) => {
            useTranscriptionStore.getState().setCurrentText(text);
          },
          onFinalResult: (text) => {
            useTranscriptionStore.getState().setCurrentText(text);
          },
          onError: (error) => {
            playErrorSound();
            useTranscriptionStore.getState().setCurrentText(
              `Web Speech hatasi: ${error}`,
            );
          },
          onEnd: () => {
            // Auto-stop veya beklenmedik kapanma
            if (isActive) {
              isActive = false;
              clearDurationTimer();
              clearMaxDurationTimer();
              clearSilenceMonitor();
              useRecordingStore.getState().setRecording(false);
              const text = getFinalTranscript();
              if (text) playDeactivationSound();
              finishWithText(text, "web").then(() => {
                restartWakeWordIfEnabled();
              });
            }
          },
        },
        { autoStopAfterSilenceMs: getSilenceTimeoutMs() },
      );
      // VAD esigi ile tarayici tarafli sessizlik izlemeyi baslat
      startBrowserSilenceMonitor();
    }, 100);
  } else {
    // Whisper modunda wake word - kayit baslat + sessizlik izleme
    const device = settings.selectedDevice ?? undefined;
    startRecording(device).then(() => {
      startSilenceMonitor();
    }).catch((err) => {
      isActive = false;
      clearDurationTimer();
      clearMaxDurationTimer();
      clearSilenceMonitor();
      useRecordingStore.getState().setRecording(false);
      useTranscriptionStore.getState().setCurrentText(`Kayit hatasi: ${err}`);
      playErrorSound();
      restartWakeWordIfEnabled();
    });
  }
}

export function useTranscription() {
  const doStart = useCallback(async () => {
    if (isActive) return;
    // Wake word listener'i durdur (SpeechRecognition cakismasi onlemi)
    stopWakeWordListener();

    // Hemen aktif olarak isaretle (bas-birak bug fix: doStop'un bizi gorebilmesi icin)
    isActive = true;
    useRecordingStore.getState().setRecording(true);
    recordingStartTime = Date.now();
    playActivationSound();

    // Backend'den ayarlari yeniden yukle
    try {
      const saved = await getSettings();
      useSettingsStore.getState().updateSettings({
        selectedModel: saved.selected_model,
        selectedDevice: saved.selected_device ?? null,
        theme: saved.theme as "dark" | "light",
        shortcut: saved.shortcut,
        recordingMode: saved.recording_mode as "button" | "auto" | "shortcut",
        vadThreshold: saved.vad_threshold,
        autoPaste: saved.auto_paste,
        language: saved.language,
        transcriptionEngine:
          (saved.transcription_engine as "whisper" | "web") || "web",
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
        notifications: saved.notifications ?? true,
        logLevel: saved.log_level ?? "info",
        paragraphBreak: saved.paragraph_break ?? false,
      });
    } catch {
      // Yuklenemezse mevcut store degerlerini kullan
    }

    // doStop bu arada cagrildiysa erken cik
    if (!isActive) {
      useRecordingStore.getState().setRecording(false);
      return;
    }

    const engine = useSettingsStore.getState().settings.transcriptionEngine;

    try {
      useRecordingStore.getState().setDuration(0);
      useTranscriptionStore.getState().setCurrentText("");

      startDurationCounter();
      startMaxDurationTimer();

      if (engine === "web") {
        if (!isWebSpeechSupported()) {
          throw new Error("Web Speech API desteklenmiyor");
        }

        const lang = useSettingsStore.getState().settings.language;
        startWebSpeech(lang, {
          onInterimResult: (text) => {
            useTranscriptionStore.getState().setCurrentText(text);
          },
          onFinalResult: (text) => {
            useTranscriptionStore.getState().setCurrentText(text);
          },
          onError: (error) => {
            playErrorSound();
            useTranscriptionStore.getState().setCurrentText(
              `Web Speech hatasi: ${error}`,
            );
          },
          onEnd: () => {
            if (isActive) {
              isActive = false;
              clearDurationTimer();
              clearMaxDurationTimer();
              clearSilenceMonitor();
              useRecordingStore.getState().setRecording(false);
              const text = getFinalTranscript();
              if (text) playDeactivationSound();
              finishWithText(text, "web").then(() => {
                restartWakeWordIfEnabled();
              });
            }
          },
        }, { autoStopAfterSilenceMs: getSilenceTimeoutMs() });
        // VAD esigi ile tarayici tarafli sessizlik izlemeyi baslat
        startBrowserSilenceMonitor();
      } else {
        const device =
          useSettingsStore.getState().settings.selectedDevice ?? undefined;
        await startRecording(device);
      }
    } catch (err) {
      isActive = false;
      clearDurationTimer();
      clearMaxDurationTimer();
      useRecordingStore.getState().setRecording(false);
      useTranscriptionStore.getState().setCurrentText(
        `Kayit baslatma hatasi: ${err}`,
      );
      playErrorSound();
      restartWakeWordIfEnabled();
    }
  }, []);

  const doStop = useCallback(async () => {
    if (!isActive) return;
    isActive = false;
    clearDurationTimer();
    clearMaxDurationTimer();
    clearSilenceMonitor();

    const engine = useSettingsStore.getState().settings.transcriptionEngine;

    if (engine === "web") {
      const text = await stopWebSpeech();
      useRecordingStore.getState().setRecording(false);
      if (text) playDeactivationSound();
      await finishWithText(text, "web");
      restartWakeWordIfEnabled();
    } else {
      try {
        const audioData = await stopRecording();
        useRecordingStore.getState().setRecording(false);
        useRecordingStore.getState().setAudioData(audioData);
        useTranscriptionStore.getState().setTranscribing(true);
        useTranscriptionStore.getState().setCurrentText("Donusturuluyor...");

        try {
          const result = await transcribeAudio(
            audioData,
            useSettingsStore.getState().settings.selectedModel,
          );

          if (result.text) {
            playDeactivationSound();
            await finishWithText(result.text, "whisper");
          } else {
            useTranscriptionStore.getState().setCurrentText("");
          }
        } catch (err) {
          playErrorSound();
          useTranscriptionStore.getState().setCurrentText(`Hata: ${err}`);
        } finally {
          useTranscriptionStore.getState().setTranscribing(false);
        }
      } catch (err) {
        playErrorSound();
        useTranscriptionStore.getState().setCurrentText(
          `Kayit durdurma hatasi: ${err}`,
        );
        useRecordingStore.getState().setRecording(false);
      }
      restartWakeWordIfEnabled();
    }
  }, []);

  const startVoiceActivation = useCallback(() => {
    const settings = useSettingsStore.getState().settings;
    if (!isActive) {
      startWakeWordListener("tr", handleWakeWord, settings.wakeWord, wakeWordStatusCallback);
    }
  }, []);

  const stopVoiceActivation = useCallback(() => {
    stopWakeWordListener();
  }, []);

  return { doStart, doStop, startVoiceActivation, stopVoiceActivation };
}
