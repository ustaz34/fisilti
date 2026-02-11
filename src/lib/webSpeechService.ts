interface WebSpeechCallbacks {
  onInterimResult?: (text: string) => void;
  onFinalResult?: (text: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
  /** Sessizlik algilandiginda bilgilendir (kalan ms) */
  onSilenceDetected?: (remainingMs: number) => void;
  /** Konusma tekrar algilandiginda bilgilendir */
  onSpeechResumed?: () => void;
}

interface WebSpeechOptions {
  /** Sessizlik sonrasi otomatik durdurma (ms). 0 = devre disi */
  autoStopAfterSilenceMs?: number;
}

import { toBcp47Locale } from "./languageUtils";

let recognition: SpeechRecognition | null = null;
let finalTranscript = "";
let stopResolve: ((text: string) => void) | null = null;
let lastResultConfidence = 1.0;

// ── Sessizlik algilama durumu ──
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let silenceCheckInterval: ReturnType<typeof setInterval> | null = null;
let lastActivityTime = 0;
let lastInterimText = "";
let hasSpeechStarted = false;
let configuredSilenceMs = 0;
let activeCallbacks: WebSpeechCallbacks | null = null;

function clearSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}

function clearSilenceCheck() {
  if (silenceCheckInterval) {
    clearInterval(silenceCheckInterval);
    silenceCheckInterval = null;
  }
}

function clearAllTimers() {
  clearSilenceTimer();
  clearSilenceCheck();
}

/**
 * Sessizlik izleme zamanlayicisini baslat/sifirla.
 * Yeni konusma/sonuc geldiginde cagirilir.
 */
function resetSilenceTimer() {
  if (configuredSilenceMs <= 0) return;
  clearSilenceTimer();
  lastActivityTime = Date.now();

  // Konusma devam ediyor — callback ile bildir
  activeCallbacks?.onSpeechResumed?.();

  silenceTimer = setTimeout(() => {
    // Sessizlik suresi doldu — otomatik durdur
    if (recognition) {
      recognition.stop();
    }
  }, configuredSilenceMs);
}

/**
 * Periyodik sessizlik kontrolu.
 * SpeechRecognition API bazen uzun sessizliklerde event gondermeyebilir.
 * Bu interval, timer'in dogru calistigini garanti eder ve
 * kalan sureyi UI'a bildirir.
 */
function startSilenceCheck() {
  clearSilenceCheck();
  if (configuredSilenceMs <= 0) return;

  silenceCheckInterval = setInterval(() => {
    if (!recognition || lastActivityTime === 0) return;

    const elapsed = Date.now() - lastActivityTime;
    const remaining = Math.max(0, configuredSilenceMs - elapsed);

    if (remaining > 0 && remaining < configuredSilenceMs) {
      activeCallbacks?.onSilenceDetected?.(remaining);
    }
  }, 500);
}

export function isWebSpeechSupported(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function startWebSpeech(
  language: string,
  callbacks: WebSpeechCallbacks,
  options?: WebSpeechOptions,
): void {
  if (recognition) {
    recognition.abort();
    recognition = null;
  }

  finalTranscript = "";
  lastInterimText = "";
  lastResultConfidence = 1.0;
  hasSpeechStarted = false;
  stopResolve = null;
  clearAllTimers();

  const SpeechRecognitionCtor =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    callbacks.onError?.("Web Speech API desteklenmiyor");
    return;
  }

  configuredSilenceMs = options?.autoStopAfterSilenceMs ?? 0;
  activeCallbacks = callbacks;

  recognition = new SpeechRecognitionCtor();
  recognition.lang = toBcp47Locale(language);
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 5;

  // ── Konusma basladi/bitti eventleri ──
  recognition.onspeechstart = () => {
    hasSpeechStarted = true;
    resetSilenceTimer();
  };

  recognition.onspeechend = () => {
    // Konusma durdu — timer zaten calisiyor, ekstra islem gerekmez
    // Ancak hasSpeechStarted sonrasi ilk sessizlik baslangici olarak kaydedelim
    if (hasSpeechStarted && configuredSilenceMs > 0) {
      lastActivityTime = Date.now();
    }
  };

  // ── Sonuc isleme ──
  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let interim = "";
    let hasFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        // En yuksek guvenilirlige sahip alternatifi sec
        let bestIdx = 0;
        let bestConf = result[0]?.confidence ?? 0;
        for (let j = 1; j < result.length; j++) {
          if (result[j] && result[j].confidence > bestConf) {
            bestConf = result[j].confidence;
            bestIdx = j;
          }
        }
        finalTranscript += result[bestIdx].transcript;
        lastResultConfidence = bestConf;
        callbacks.onFinalResult?.(finalTranscript);
        hasFinal = true;
      } else {
        interim += result[0].transcript;
      }
    }
    if (interim) {
      callbacks.onInterimResult?.(finalTranscript + interim);
    }

    // Yeni icerik geldiginde timer'i resetle
    // Degismemis interim sonuclarda resetleme (sessizlik algilansin)
    if (hasFinal || (interim && interim !== lastInterimText)) {
      resetSilenceTimer();
    }
    lastInterimText = interim;
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (event.error === "aborted") return;
    callbacks.onError?.(event.error);
  };

  recognition.onend = () => {
    recognition = null;
    clearAllTimers();
    activeCallbacks = null;
    // Kisa konusmalarda API final result uretmeyebilir — interim'i fallback olarak kullan
    const resultText = finalTranscript || lastInterimText;
    if (!finalTranscript && lastInterimText) {
      finalTranscript = lastInterimText;
    }
    // stop() cagrildiysa promise'i coz
    if (stopResolve) {
      stopResolve(resultText);
      stopResolve = null;
    }
    // Her durumda onEnd'i bildir (sessizlik auto-stop veya beklenmedik kapanma)
    callbacks.onEnd?.();
  };

  recognition.start();

  // Ilk sessizlik zamanlayicisini baslat (konusmaya baslamazsa diye)
  lastActivityTime = Date.now();
  resetSilenceTimer();
  startSilenceCheck();
}

export function stopWebSpeech(): Promise<string> {
  clearAllTimers();
  activeCallbacks = null;
  return new Promise((resolve) => {
    if (!recognition) {
      // Kisa konusma fallback: interim varsa onu kullan
      resolve(finalTranscript || lastInterimText);
      return;
    }
    stopResolve = resolve;
    recognition.stop();
    // Guvenlik zamanlayicisi - onend gelmezse 3 saniyede coz
    setTimeout(() => {
      if (stopResolve === resolve) {
        stopResolve = null;
        if (recognition) {
          recognition.abort();
          recognition = null;
        }
        resolve(finalTranscript || lastInterimText);
      }
    }, 3000);
  });
}

export function getFinalTranscript(): string {
  // Kisa konusmalarda final result olmayabilir — interim'i fallback olarak kullan
  return finalTranscript || lastInterimText;
}

export function getResultConfidence(): number {
  return lastResultConfidence;
}
