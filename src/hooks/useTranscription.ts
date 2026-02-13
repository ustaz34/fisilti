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
  startDeepgram,
  stopDeepgram,
  getDeepgramTranscript,
} from "../lib/deepgramService";
import {
  startAzureSpeech,
  stopAzureSpeech,
  getAzureTranscript,
} from "../lib/azureSpeechService";
import { transcribeWithGoogleCloud } from "../lib/googleCloudSpeechService";
import { useUsageStore } from "../stores/usageStore";
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
  stopBrowserAudioMonitor,
} from "../lib/browserAudioMonitor";
import {
  stopSileroVad,
} from "../lib/sileroVadService";

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
  // Silero VAD'i durdur
  stopSileroVad().catch(() => {});
}

/**
 * Whisper icin sessizlik izleme
 * Backend'den ses seviyesini pollla, sessizlik suresi dolunca kaydi durdur
 */
function startSilenceMonitor() {
  clearSilenceMonitor();
  const minSpeechBeforeStop = 1500;
  const noSpeechTimeoutMs = 10000;

  silenceMonitorTimer = setInterval(async () => {
    if (!isActive) {
      clearSilenceMonitor();
      return;
    }

    // Threshold ve timeout'u her iterasyonda dinamik oku
    const curSettings = useSettingsStore.getState().settings;
    // Konusma baslama esigi: kullanicinin hassasiyet ayari (dusuk = hassas)
    const speechThreshold = Math.max((curSettings.vadThreshold || 0.3) * 0.025, 0.003);
    // Sessizlik esigi: konusma esiginden bagimsiz minimum taban
    // Arka plan gurultusu (0.003-0.005) sessizlik zamanlayicisini resetlemesin
    const silenceFloor = Math.max(speechThreshold, 0.006);
    const silenceTimeoutMs = getSilenceTimeoutMs();

    try {
      const level = await getAudioLevels();

      // Konusma algilama: hassas esik
      if (level >= speechThreshold) {
        hasDetectedSpeech = true;
      }
      // Sessizlik zamanlayici: sadece gercek ses (silenceFloor ustu) resetler
      if (level >= silenceFloor) {
        silenceStartTime = 0;
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

type EngineType = "web" | "whisper" | "deepgram" | "azure" | "google-cloud";

async function finishWithText(text: string, engineOverride?: EngineType) {
  if (!text) {
    useTranscriptionStore.getState().setCurrentText("");
    return;
  }

  const settings = useSettingsStore.getState().settings;
  const durationMs = Date.now() - recordingStartTime;
  const engine = engineOverride || settings.transcriptionEngine;

  // Web Speech ve bulut motor sonuclarini backend'de isle (noktalama, duzeltme vs.)
  let processedText = text;
  let originalText: string | undefined;
  if (engine === "web" || engine === "deepgram" || engine === "azure" || engine === "google-cloud") {
    try {
      processedText = await processText(text);
      if (processedText !== text) {
        originalText = text;
      }
    } catch {
      // hata durumunda orijinal metni kullan
    }
  }

  // Kullanim takibi — bulut motorlari icin
  if (engine === "deepgram" || engine === "azure" || engine === "google-cloud") {
    const provider = engine === "google-cloud" ? "googleCloud" : engine;
    useUsageStore.getState().addUsage(provider as "deepgram" | "azure" | "googleCloud", durationMs);
  }

  const modelIdMap: Record<string, string> = {
    web: "web-speech",
    deepgram: "deepgram-nova-3",
    azure: "azure-speech",
    "google-cloud": "google-cloud-chirp",
  };

  useTranscriptionStore.getState().setCurrentText(processedText);
  useTranscriptionStore.getState().addToHistory({
    id: Date.now().toString(),
    text: processedText,
    originalText,
    timestamp: Date.now(),
    durationMs,
    engine: engine as EngineType,
    language: settings.language,
    modelId: modelIdMap[engine] || settings.selectedModel,
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
      startWakeWordListener(settings.language, handleWakeWord, settings.wakeWord, wakeWordStatusCallback);
    }, 500); // 300ms -> 500ms: SpeechRecognition abort async — cakismayi onle
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
      if (text) playDeactivationSound(); else playErrorSound();
      finishWithText(text, "web").then(() => {
        restartWakeWordIfEnabled();
      });
    });
  } else if (engine === "deepgram") {
    stopDeepgram().then((text) => {
      useRecordingStore.getState().setRecording(false);
      if (text) playDeactivationSound(); else playErrorSound();
      finishWithText(text, "deepgram").then(() => {
        restartWakeWordIfEnabled();
      });
    });
  } else if (engine === "azure") {
    stopAzureSpeech().then((text) => {
      useRecordingStore.getState().setRecording(false);
      if (text) playDeactivationSound(); else playErrorSound();
      finishWithText(text, "azure").then(() => {
        restartWakeWordIfEnabled();
      });
    });
  } else if (engine === "google-cloud") {
    // Google Cloud batch mod — Whisper gibi kayit durdur + transkript
    stopRecording().then(async (audioData) => {
      useRecordingStore.getState().setRecording(false);
      useRecordingStore.getState().setAudioData(audioData);
      useTranscriptionStore.getState().setTranscribing(true);
      useTranscriptionStore.getState().setCurrentText("Donusturuluyor...");
      try {
        const apiKey = useSettingsStore.getState().settings.googleCloudApiKey;
        const lang = useSettingsStore.getState().settings.language;
        const text = await transcribeWithGoogleCloud(apiKey, audioData, lang);
        if (text) {
          playDeactivationSound();
          await finishWithText(text, "google-cloud");
        } else {
          playErrorSound();
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
  } else {
    // Whisper
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
          playErrorSound();
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
            if (isActive) {
              isActive = false;
              clearDurationTimer();
              clearMaxDurationTimer();
              clearSilenceMonitor();
              useRecordingStore.getState().setRecording(false);
              const text = getFinalTranscript();
              if (text) playDeactivationSound(); else playErrorSound();
              finishWithText(text, "web").then(() => {
                restartWakeWordIfEnabled();
              });
            }
          },
        },
        { autoStopAfterSilenceMs: getSilenceTimeoutMs() },
      );
      // NOT: startBrowserSilenceMonitor() KALDIRILDI — webSpeechService'deki
      // dahili autoStopAfterSilenceMs yeterli. Cift monitor cakisiyordu:
      // harici doForceStop() smart restart zincirini kiriyordu.
    }, 200);
  } else if (engine === "deepgram") {
    const apiKey = settings.deepgramApiKey;
    const lang = settings.language;
    setTimeout(() => {
      startDeepgram(apiKey, lang, {
        onInterimResult: (text) => {
          useTranscriptionStore.getState().setCurrentText(text);
        },
        onFinalResult: (text) => {
          useTranscriptionStore.getState().setCurrentText(text);
        },
        onError: (error) => {
          playErrorSound();
          useTranscriptionStore.getState().setCurrentText(`Deepgram hatasi: ${error}`);
        },
        onEnd: () => {
          if (isActive) {
            isActive = false;
            clearDurationTimer();
            clearMaxDurationTimer();
            clearSilenceMonitor();
            useRecordingStore.getState().setRecording(false);
            const text = getDeepgramTranscript();
            if (text) playDeactivationSound(); else playErrorSound();
            finishWithText(text, "deepgram").then(() => {
              restartWakeWordIfEnabled();
            });
          }
        },
      });
      // Deepgram kendi sessizlik algilamasini yapar — harici monitor gereksiz
    }, 200);
  } else if (engine === "azure") {
    const key = settings.azureSpeechKey;
    const region = settings.azureSpeechRegion;
    const lang = settings.language;
    setTimeout(() => {
      startAzureSpeech(key, region, lang, {
        onInterimResult: (text) => {
          useTranscriptionStore.getState().setCurrentText(text);
        },
        onFinalResult: (text) => {
          useTranscriptionStore.getState().setCurrentText(text);
        },
        onError: (error) => {
          playErrorSound();
          useTranscriptionStore.getState().setCurrentText(`Azure hatasi: ${error}`);
        },
        onEnd: () => {
          if (isActive) {
            isActive = false;
            clearDurationTimer();
            clearMaxDurationTimer();
            clearSilenceMonitor();
            useRecordingStore.getState().setRecording(false);
            const text = getAzureTranscript();
            if (text) playDeactivationSound(); else playErrorSound();
            finishWithText(text, "azure").then(() => {
              restartWakeWordIfEnabled();
            });
          }
        },
      });
    }, 100);
  } else if (engine === "google-cloud") {
    // Google Cloud batch mod — Whisper gibi kayit baslat + sessizlik izleme
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

    // Backend'den ayarlari arka planda yukle (kaydi BLOKLAMADAN)
    getSettings().then((saved) => {
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
          (saved.transcription_engine as EngineType) || "web",
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
        notifications: saved.notifications ?? true,
        logLevel: saved.log_level ?? "info",
        paragraphBreak: saved.paragraph_break ?? false,
      });
    }).catch(() => {
      // Yuklenemezse mevcut store degerlerini kullan
    });

    // Mevcut store degerlerini hemen kullan (IPC beklemeden)
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
        // Push-to-talk/buton modu: sessizlik izleme YOK — kullanici birakinca durur
        // noAutoRestart: oturum restart'ini engelle — kisa kelimelerin kaybolmasini onler
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
              if (text) playDeactivationSound(); else playErrorSound();
              finishWithText(text, "web").then(() => {
                restartWakeWordIfEnabled();
              });
            }
          },
        }, { noAutoRestart: true });
      } else if (engine === "deepgram") {
        const s = useSettingsStore.getState().settings;
        if (!s.deepgramApiKey) throw new Error("Deepgram API key girilmemis");
        startDeepgram(s.deepgramApiKey, s.language, {
          onInterimResult: (text) => {
            useTranscriptionStore.getState().setCurrentText(text);
          },
          onFinalResult: (text) => {
            useTranscriptionStore.getState().setCurrentText(text);
          },
          onError: (error) => {
            playErrorSound();
            useTranscriptionStore.getState().setCurrentText(`Deepgram hatasi: ${error}`);
          },
          onEnd: () => {
            if (isActive) {
              isActive = false;
              clearDurationTimer();
              clearMaxDurationTimer();
              clearSilenceMonitor();
              useRecordingStore.getState().setRecording(false);
              const text = getDeepgramTranscript();
              if (text) playDeactivationSound(); else playErrorSound();
              finishWithText(text, "deepgram").then(() => {
                restartWakeWordIfEnabled();
              });
            }
          },
        });
        // Push-to-talk: sessizlik izleme yok
      } else if (engine === "azure") {
        const s = useSettingsStore.getState().settings;
        if (!s.azureSpeechKey || !s.azureSpeechRegion) throw new Error("Azure Speech key veya region girilmemis");
        await startAzureSpeech(s.azureSpeechKey, s.azureSpeechRegion, s.language, {
          onInterimResult: (text) => {
            useTranscriptionStore.getState().setCurrentText(text);
          },
          onFinalResult: (text) => {
            useTranscriptionStore.getState().setCurrentText(text);
          },
          onError: (error) => {
            playErrorSound();
            useTranscriptionStore.getState().setCurrentText(`Azure hatasi: ${error}`);
          },
          onEnd: () => {
            if (isActive) {
              isActive = false;
              clearDurationTimer();
              clearMaxDurationTimer();
              clearSilenceMonitor();
              useRecordingStore.getState().setRecording(false);
              const text = getAzureTranscript();
              if (text) playDeactivationSound(); else playErrorSound();
              finishWithText(text, "azure").then(() => {
                restartWakeWordIfEnabled();
              });
            }
          },
        });
      } else if (engine === "google-cloud") {
        // Google Cloud batch mod — Whisper gibi kayit baslat
        const s = useSettingsStore.getState().settings;
        if (!s.googleCloudApiKey) throw new Error("Google Cloud API key girilmemis");
        const device = s.selectedDevice ?? undefined;
        await startRecording(device);
      } else {
        // Whisper
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
      if (text) playDeactivationSound(); else playErrorSound();
      await finishWithText(text, "web");
      restartWakeWordIfEnabled();
    } else if (engine === "deepgram") {
      const text = await stopDeepgram();
      useRecordingStore.getState().setRecording(false);
      if (text) playDeactivationSound(); else playErrorSound();
      await finishWithText(text, "deepgram");
      restartWakeWordIfEnabled();
    } else if (engine === "azure") {
      const text = await stopAzureSpeech();
      useRecordingStore.getState().setRecording(false);
      if (text) playDeactivationSound(); else playErrorSound();
      await finishWithText(text, "azure");
      restartWakeWordIfEnabled();
    } else if (engine === "google-cloud") {
      // Google Cloud batch mod — kayit durdur + transkript
      try {
        const audioData = await stopRecording();
        useRecordingStore.getState().setRecording(false);
        useRecordingStore.getState().setAudioData(audioData);
        useTranscriptionStore.getState().setTranscribing(true);
        useTranscriptionStore.getState().setCurrentText("Donusturuluyor...");

        try {
          const s = useSettingsStore.getState().settings;
          const text = await transcribeWithGoogleCloud(s.googleCloudApiKey, audioData, s.language);
          if (text) {
            playDeactivationSound();
            await finishWithText(text, "google-cloud");
          } else {
            playErrorSound();
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
        useTranscriptionStore.getState().setCurrentText(`Kayit durdurma hatasi: ${err}`);
        useRecordingStore.getState().setRecording(false);
      }
      restartWakeWordIfEnabled();
    } else {
      // Whisper
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
            playErrorSound();
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
      startWakeWordListener(settings.language, handleWakeWord, settings.wakeWord, wakeWordStatusCallback);
    }
  }, []);

  const stopVoiceActivation = useCallback(() => {
    stopWakeWordListener();
  }, []);

  return { doStart, doStop, startVoiceActivation, stopVoiceActivation };
}
