/**
 * Wake Word Listener - Ayarlanabilir uyanma kelimesi ile ses tanima servisi.
 *
 * Web Speech API'yi continuous modda calistirir.
 * Surekli dinler, uyanma kelimesini duyunca onWakeWord callback'ini tetikler.
 * Beklenmedik kapanmalarda aninda yeniden baslar.
 *
 * Mikrofon izni otomatik istenir, durum callback'leri ile UI'a bildirim gider.
 */

import type { WakeWordStatus } from "../stores/settingsStore";
import { toBcp47Locale } from "./languageUtils";
import { emit } from "@tauri-apps/api/event";

let recognition: SpeechRecognition | null = null;
let shouldRestart = false;
let currentWakeWord = "fısıltı";
/** Session sayaci - eski onend/onerror callback'lerinin yeni session'i ezmesini onler */
let sessionCounter = 0;
/** Wake word tespit edildiginde onWakeWord callback'ini onend'e kadar erteler */
let pendingWakeWordCallback: (() => void) | null = null;
/** Durum callback'i — UI'a anlık bildirim gondermek icin */
let statusCallback: ((status: WakeWordStatus, error?: string) => void) | null = null;

function reportStatus(status: WakeWordStatus, error?: string) {
  statusCallback?.(status, error);
  // Ayarlar penceresine durum bildir (ayri WebView2 — store paylasılmıyor)
  emit("wake-word-status", { status, error: error ?? null }).catch(() => {});
}

/**
 * Turkce "ı"/"i" karakter varyantlarini otomatik olusturur.
 * Ornegin "fısıltı" -> ["fısıltı", "fisılti", "fısılti", "fisilti", ...]
 */
function generateTurkishVariants(word: string): string[] {
  const lower = word.toLowerCase();
  const positions: number[] = [];
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] === "ı" || lower[i] === "i") {
      positions.push(i);
    }
  }

  if (positions.length === 0) return [lower];

  const variants = new Set<string>();
  const total = 1 << positions.length;
  for (let mask = 0; mask < total; mask++) {
    const chars = lower.split("");
    for (let j = 0; j < positions.length; j++) {
      chars[positions[j]] = mask & (1 << j) ? "i" : "ı";
    }
    variants.add(chars.join(""));
  }

  return Array.from(variants);
}

// Varsayilan wake word icin varyantlari hemen olustur
let cachedVariants: string[] = generateTurkishVariants("fısıltı");

function matchesWakeWord(text: string): boolean {
  const lower = text.toLowerCase().trim();

  for (const variant of cachedVariants) {
    if (lower.includes(variant)) return true;
  }

  // "fısıltı" icin ek olarak fonetik varyantlari ve "whisper" ingilizcesini de yakala
  if (currentWakeWord === "fısıltı" || currentWakeWord === "fisılti" || currentWakeWord === "fisilti") {
    if (lower.includes("whisper")) return true;
    if (lower.includes("whisp")) return true;
    if (lower.includes("fısıl")) return true;
    if (lower.includes("fisil")) return true;
    if (lower.includes("fisilt")) return true;
    if (lower.includes("fısılt")) return true;
    if (lower.includes("visil")) return true;
    if (lower.includes("vısıl")) return true;
    if (lower.includes("visilt")) return true;
    if (lower.includes("fıs")) return true;
    if (lower.includes("fis")) return true;
    if (lower.includes("wis")) return true;
  }

  return false;
}

/**
 * Mikrofon izni iste — WebView2/tarayici'nin sessizce reddetmesini onler.
 * SpeechRecognition baslatilmadan once cagirilmali.
 */
async function ensureMicPermission(): Promise<boolean> {
  try {
    reportStatus("requesting_mic");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Izin alindi, stream'i hemen birak
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("not allowed") || msg.includes("Permission denied") || err?.name === "NotAllowedError") {
      reportStatus("error", "Mikrofon izni reddedildi");
    } else if (err?.name === "NotFoundError") {
      reportStatus("error", "Mikrofon bulunamadi");
    } else {
      reportStatus("error", `Mikrofon hatasi: ${msg}`);
    }
    return false;
  }
}

function startSession(language: string, onWakeWord: () => void) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    reportStatus("no_support");
    shouldRestart = false;
    return;
  }

  sessionCounter++;
  const mySession = sessionCounter;

  reportStatus("starting");

  const rec = new Ctor();
  rec.lang = toBcp47Locale(language);
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 10;

  rec.onresult = (event: SpeechRecognitionEvent) => {
    if (mySession !== sessionCounter) return;
    // Her sonuçta son duyulan metni gönder
    const lastTranscript = event.results[event.results.length - 1][0].transcript;
    reportStatus("hearing", lastTranscript.trim());
    for (let i = event.resultIndex; i < event.results.length; i++) {
      for (let j = 0; j < event.results[i].length; j++) {
        if (matchesWakeWord(event.results[i][j].transcript)) {
          reportStatus("detected");
          shouldRestart = false;
          pendingWakeWordCallback = onWakeWord;
          rec.abort();
          recognition = null;
          // Safety timeout: if onend doesn't fire within 500ms, call callback anyway
          setTimeout(() => {
            if (pendingWakeWordCallback) {
              const cb = pendingWakeWordCallback;
              pendingWakeWordCallback = null;
              cb();
            }
          }, 500);
          return;
        }
      }
    }
  };

  rec.onaudiostart = () => {
    if (mySession !== sessionCounter) return;
    reportStatus("listening");
  };

  rec.onend = () => {
    // Eski session'in callback'i ise hicbir sey yapma
    if (mySession !== sessionCounter) return;
    recognition = null;
    if (pendingWakeWordCallback) {
      const cb = pendingWakeWordCallback;
      pendingWakeWordCallback = null;
      cb();
      return;
    }
    if (shouldRestart) {
      startSession(language, onWakeWord);
    }
  };

  rec.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (mySession !== sessionCounter) return;
    if (event.error === "aborted") return;
    if (event.error === "no-speech") return;

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      reportStatus("error", "Mikrofon izni reddedildi");
      shouldRestart = false;
      recognition = null;
      return;
    }

    if (event.error === "audio-capture") {
      recognition = null;
      // Mikrofon gecici mesgul olabilir (kayit bittiginde serbest kalir)
      if (shouldRestart) {
        reportStatus("starting");
        setTimeout(() => {
          if (shouldRestart && mySession === sessionCounter) {
            startSession(language, onWakeWord);
          }
        }, 2000);
      } else {
        reportStatus("error", "Mikrofon yakalanamadi");
      }
      return;
    }

    if (event.error === "network") {
      recognition = null;
      if (shouldRestart) {
        reportStatus("starting");
        setTimeout(() => {
          if (shouldRestart && mySession === sessionCounter) {
            startSession(language, onWakeWord);
          }
        }, 1500); // 200ms -> 1500ms: network hatasi sonrasi daha uzun bekleme
      }
      return;
    }
    console.warn("Wake word listener error:", event.error);
    reportStatus("error", `Beklenmeyen hata: ${event.error}`);
  };

  recognition = rec;

  try {
    rec.start();
  } catch {
    setTimeout(() => {
      if (shouldRestart && mySession === sessionCounter) {
        startSession(language, onWakeWord);
      }
    }, 100);
  }
}

export async function startWakeWordListener(
  language: string,
  onWakeWord: () => void,
  wakeWord?: string,
  onStatus?: (status: WakeWordStatus, error?: string) => void,
): Promise<void> {
  stopWakeWordListener();

  if (onStatus) {
    statusCallback = onStatus;
  }

  if (wakeWord) {
    currentWakeWord = wakeWord;
    cachedVariants = generateTurkishVariants(wakeWord);
  }

  // SpeechRecognition destegi var mi?
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    reportStatus("no_support");
    return;
  }

  // Mikrofon izni al
  const hasMic = await ensureMicPermission();
  if (!hasMic) {
    return;
  }

  shouldRestart = true;
  // Eski session'in onend'inin temizlenmesi icin kisa bekleme
  setTimeout(() => {
    if (shouldRestart) {
      startSession(language, onWakeWord);
    }
  }, 50);
}

export function stopWakeWordListener(): void {
  shouldRestart = false;
  sessionCounter++; // Eski callback'leri gecersiz kil
  pendingWakeWordCallback = null;
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
  reportStatus("inactive");
}

/**
 * Listener'i yeniden baslatmadan wake word'u guncelle.
 * Mevcut SpeechRecognition oturumunu bozmaz, sadece eslestirme kriterlerini degistirir.
 */
export function updateWakeWord(word: string): void {
  currentWakeWord = word;
  cachedVariants = generateTurkishVariants(word);
}

export function isWakeWordActive(): boolean {
  return shouldRestart;
}
