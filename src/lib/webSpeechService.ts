/**
 * Google Web Speech API servisi — Turkce icin optimize edilmis.
 *
 * Temel stratejiler:
 * 1. Akilli oturum yenileme: sessizlik aninda restart (cumle ortasinda kesmez)
 * 2. Turkce-bilinçli alternatif secimi: confidence + Turkce karakter skoru
 * 3. Interim izleme: final'den iyi oldugunda interim tercih edilir
 * 4. Cumle parcalanmasini onleme: restart sirasinda interim korunur
 */

interface WebSpeechCallbacks {
  onInterimResult?: (text: string) => void;
  onFinalResult?: (text: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
  onSilenceDetected?: (remainingMs: number) => void;
  onSpeechResumed?: () => void;
}

interface WebSpeechOptions {
  autoStopAfterSilenceMs?: number;
}

import { toBcp47Locale } from "./languageUtils";

// ── Ana durum ──
let recognition: SpeechRecognition | null = null;
let finalTranscript = "";
let stopResolve: ((text: string) => void) | null = null;
let lastResultConfidence = 1.0;

// ── Sessizlik algilama ──
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let silenceCheckInterval: ReturnType<typeof setInterval> | null = null;
let lastActivityTime = 0;
let lastInterimText = "";
let hasSpeechStarted = false;
let configuredSilenceMs = 0;
let activeCallbacks: WebSpeechCallbacks | null = null;

// ── Oturum yenileme ──
let isRestarting = false;
let savedLanguage = "";
let savedCallbacks: WebSpeechCallbacks | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let sessionStartTime = 0;
let lastFinalResultTime = 0;
let currentSessionFinalCount = 0;
let errorRetryCount = 0;
const MAX_ERROR_RETRIES = 3;

// ── Interim izleme (kalite karsilastirma) ──
let bestInterimBeforeFinal = "";
let interimWordCount = 0;

// Oturum yenileme zamanlayicilari
// Minimum oturum suresi: bundan once restart yapma (yeni oturuma firsat ver)
const MIN_SESSION_MS = 8000;
// Maksimum oturum suresi: ne olursa olsun restart yap (Google baglam kirlenmesi)
const MAX_SESSION_MS = 45000;
// Final result sonrasi sessizlik bekleme: bu sure icerisinde yeni interim gelmezse restart
const RESTART_AFTER_SILENCE_MS = 2000;

// ── Turkce karakter skoru ──
const TURKISH_CHARS = new Set(['ç', 'ğ', 'ı', 'ö', 'ş', 'ü', 'Ç', 'Ğ', 'İ', 'Ö', 'Ş', 'Ü']);

function turkishScore(text: string): number {
  if (!text) return 0;
  let score = 0;
  for (const ch of text) {
    if (TURKISH_CHARS.has(ch)) score += 4;
  }
  // Kelime sayisi da onemli: daha fazla kelime = daha iyi tanima
  const words = text.trim().split(/\s+/).length;
  score += words;
  return score;
}

/**
 * Alternatifler arasinda en iyi sonucu sec.
 * Sadece confidence degil, Turkce karakter varligi ve kelime sayisi da deger.
 */
function pickBestAlternative(result: SpeechRecognitionResult): { text: string; confidence: number; idx: number } {
  let bestIdx = 0;
  let bestScore = -1;
  let bestConf = result[0]?.confidence ?? 0;

  for (let j = 0; j < result.length; j++) {
    if (!result[j]) continue;
    const conf = result[j].confidence;
    const text = result[j].transcript;

    // Bilesik skor: confidence * 100 + turkce_skoru
    // Turkce karakter iceren sonuclar tercih edilir (Google bazen ASCII doner)
    const score = conf * 100 + turkishScore(text);

    if (score > bestScore) {
      bestScore = score;
      bestIdx = j;
      bestConf = conf;
    }
  }

  return {
    text: result[bestIdx]?.transcript ?? "",
    confidence: bestConf,
    idx: bestIdx,
  };
}

/**
 * Interim alternatifler arasinda en iyisini sec (ayni turkce-bilinçli mantik).
 */
function pickBestInterim(result: SpeechRecognitionResult): string {
  let bestText = result[0]?.transcript ?? "";
  let bestScore = turkishScore(bestText) + (result[0]?.confidence ?? 0) * 50;

  for (let j = 1; j < result.length; j++) {
    if (!result[j]) continue;
    const text = result[j].transcript;
    const score = turkishScore(text) + (result[j].confidence ?? 0) * 50;
    if (score > bestScore) {
      bestScore = score;
      bestText = text;
    }
  }

  return bestText;
}

// ── Timer yonetimi ──

function clearSilenceTimer() {
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
}

function clearSilenceCheck() {
  if (silenceCheckInterval) { clearInterval(silenceCheckInterval); silenceCheckInterval = null; }
}

function clearRestartTimer() {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
}

function clearAllTimers() {
  clearSilenceTimer();
  clearSilenceCheck();
  clearRestartTimer();
}

function resetSilenceTimer() {
  if (configuredSilenceMs <= 0) return;
  clearSilenceTimer();
  lastActivityTime = Date.now();
  activeCallbacks?.onSpeechResumed?.();

  silenceTimer = setTimeout(() => {
    if (recognition) recognition.stop();
  }, configuredSilenceMs);
}

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

/**
 * Akilli oturum yenileme zamanlayicisi.
 * Final result geldiginde: kisa bir sessizlik bekle, sonra restart yap.
 * Eger konusma devam ediyorsa (interim geliyor), restart yapma.
 * Maksimum oturum suresi asildiysa zorla restart yap.
 */
function scheduleSmartRestart() {
  clearRestartTimer();

  const sessionAge = Date.now() - sessionStartTime;

  // Oturum cok genc — restart yapma
  if (sessionAge < MIN_SESSION_MS) {
    // Minimum oturum suresinden sonra tekrar dene
    restartTimer = setTimeout(() => scheduleSmartRestart(), MIN_SESSION_MS - sessionAge + 100);
    return;
  }

  // Oturum cok yaslandi — zorla restart
  if (sessionAge >= MAX_SESSION_MS) {
    triggerRestart();
    return;
  }

  // Normal durum: final result sonrasi kisa sessizlik bekle
  // Eger bu sure icinde yeni interim gelmezse restart yap (dogal duraklama)
  restartTimer = setTimeout(() => {
    // Son final result'tan beri yeni interim geldi mi?
    const timeSinceLastFinal = Date.now() - lastFinalResultTime;
    if (timeSinceLastFinal >= RESTART_AFTER_SILENCE_MS) {
      // Konusma duraklamis — guvenli restart
      triggerRestart();
    } else {
      // Hala konusuyor — bir sonraki final'i bekle
      // (bir sonraki final geldiginde scheduleSmartRestart tekrar cagrilacak)
    }
  }, RESTART_AFTER_SILENCE_MS);
}

function triggerRestart() {
  if (!recognition || isRestarting || stopResolve) return;
  isRestarting = true;
  try {
    recognition.stop();
  } catch {
    isRestarting = false;
  }
}

// ── Recognition olusturma ──

function createAndStartRecognition() {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) return;

  const callbacks = savedCallbacks!;

  recognition = new SpeechRecognitionCtor();
  recognition.lang = toBcp47Locale(savedLanguage);
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 10;

  sessionStartTime = Date.now();
  currentSessionFinalCount = 0;
  bestInterimBeforeFinal = "";
  interimWordCount = 0;

  // ── Konusma eventleri ──
  recognition.onspeechstart = () => {
    hasSpeechStarted = true;
    resetSilenceTimer();
  };

  recognition.onspeechend = () => {
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
        const best = pickBestAlternative(result);
        let seg = best.text;

        // Interim izleme: eger interim daha uzun ve daha fazla Turkce karakter iceriyorsa,
        // final yerine interim'i kullan (Google bazen final'de kelime dusuruyor)
        if (bestInterimBeforeFinal) {
          const interimWords = bestInterimBeforeFinal.trim().split(/\s+/).length;
          const finalWords = seg.trim().split(/\s+/).length;
          const interimTurkish = turkishScore(bestInterimBeforeFinal);
          const finalTurkish = turkishScore(seg);

          // Interim tercih: 3 esnek kosul (herhangi biri yeterli)
          const useInterim =
            // 1. Interim daha fazla kelime VE daha fazla Turkce → kesin interim
            (interimWords > finalWords && interimTurkish > finalTurkish) ||
            // 2. Ayni kelime sayisi ama interim 2+ daha fazla Turkce char → interim
            (interimWords === finalWords && interimTurkish >= finalTurkish + 2) ||
            // 3. Final'da 2+ kelime kayip VE interim'de en az 1 Turkce char var → interim
            (finalWords <= interimWords - 2 && interimTurkish > 0);

          if (useInterim) {
            seg = bestInterimBeforeFinal;
          }
        }

        if (finalTranscript && !finalTranscript.endsWith(' ') && seg && !seg.startsWith(' ')) {
          finalTranscript += ' ';
        }
        finalTranscript += seg;

        lastResultConfidence = best.confidence;
        lastFinalResultTime = Date.now();
        currentSessionFinalCount++;
        bestInterimBeforeFinal = "";
        interimWordCount = 0;

        callbacks.onFinalResult?.(finalTranscript);
        hasFinal = true;
      } else {
        const bestInt = pickBestInterim(result);
        interim += bestInt;
      }
    }

    // Interim izleme: her interim'de en iyi versiyonu sakla
    if (interim) {
      const words = interim.trim().split(/\s+/).length;
      if (words >= interimWordCount) {
        bestInterimBeforeFinal = interim;
        interimWordCount = words;
      }
      callbacks.onInterimResult?.(finalTranscript + interim);
    }

    // Aktivite timer'i resetle
    if (hasFinal || (interim && interim !== lastInterimText)) {
      resetSilenceTimer();
    }
    lastInterimText = interim;

    // Final result geldi — akilli restart zamanlayicisini baslat
    if (hasFinal) {
      scheduleSmartRestart();
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (event.error === "aborted") return;
    if (isRestarting && event.error === "no-speech") return;
    // network hatasi veya not-allowed = ciddi, bildir
    callbacks.onError?.(event.error);

    // network ve audio-capture hatalari icin otomatik yeniden baslama
    if ((event.error === "network" || event.error === "audio-capture") && errorRetryCount < MAX_ERROR_RETRIES) {
      errorRetryCount++;
      setTimeout(() => {
        if (!recognition && savedCallbacks && !stopResolve) {
          try {
            createAndStartRecognition();
          } catch {
            // Yeniden baslama basarisiz — birak
          }
        }
      }, 2000);
    }
  };

  recognition.onend = () => {
    recognition = null;

    if (isRestarting) {
      isRestarting = false;
      // Devam eden interim'i koru
      if (lastInterimText) {
        if (finalTranscript && !finalTranscript.endsWith(' ') && !lastInterimText.startsWith(' ')) {
          finalTranscript += ' ';
        }
        finalTranscript += lastInterimText;
        // UI'i da guncelle — kullanici eklenen metni gormus olsun
        callbacks.onFinalResult?.(finalTranscript);
      }
      lastInterimText = "";
      bestInterimBeforeFinal = "";
      interimWordCount = 0;
      try {
        createAndStartRecognition();
      } catch {
        cleanupAndFinish(callbacks);
      }
      return;
    }

    cleanupAndFinish(callbacks);
  };

  recognition.start();
}

function cleanupAndFinish(callbacks: WebSpeechCallbacks) {
  recognition = null;
  clearAllTimers();
  activeCallbacks = null;

  // Kisa konusmalarda final result uretilmemis olabilir — interim fallback
  const resultText = finalTranscript || lastInterimText;
  if (!finalTranscript && lastInterimText) {
    finalTranscript = lastInterimText;
  }

  if (stopResolve) {
    stopResolve(resultText);
    stopResolve = null;
  }
  callbacks.onEnd?.();
}

// ── Public API ──

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

  // Tum durumu sifirla
  finalTranscript = "";
  lastInterimText = "";
  lastResultConfidence = 1.0;
  hasSpeechStarted = false;
  isRestarting = false;
  stopResolve = null;
  bestInterimBeforeFinal = "";
  interimWordCount = 0;
  lastFinalResultTime = 0;
  currentSessionFinalCount = 0;
  errorRetryCount = 0;
  clearAllTimers();

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    callbacks.onError?.("Web Speech API desteklenmiyor");
    return;
  }

  configuredSilenceMs = options?.autoStopAfterSilenceMs ?? 0;
  activeCallbacks = callbacks;
  savedLanguage = language;
  savedCallbacks = callbacks;

  createAndStartRecognition();

  lastActivityTime = Date.now();
  resetSilenceTimer();
  startSilenceCheck();
}

export function stopWebSpeech(): Promise<string> {
  clearAllTimers();
  isRestarting = false;
  activeCallbacks = null;
  return new Promise((resolve) => {
    if (!recognition) {
      resolve(finalTranscript || lastInterimText);
      return;
    }
    stopResolve = resolve;
    recognition.stop();
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
  return finalTranscript || lastInterimText;
}

export function getResultConfidence(): number {
  return lastResultConfidence;
}
