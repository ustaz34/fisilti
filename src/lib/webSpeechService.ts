/**
 * Google Web Speech API servisi — sade versiyon.
 */

interface WebSpeechCallbacks {
  onInterimResult?: (text: string) => void;
  onFinalResult?: (text: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

interface WebSpeechOptions {
  autoStopAfterSilenceMs?: number;
  noAutoRestart?: boolean;
}

import { toBcp47Locale } from "./languageUtils";

let recognition: SpeechRecognition | null = null;
let finalTranscript = "";
let lastInterimText = "";
let stopResolve: ((text: string) => void) | null = null;
let lastResultConfidence = 1.0;

// Sessizlik
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let configuredSilenceMs = 0;

function clearSilenceTimer() {
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
}

function resetSilenceTimer() {
  if (configuredSilenceMs <= 0) return;
  clearSilenceTimer();
  silenceTimer = setTimeout(() => {
    if (recognition) recognition.stop();
  }, configuredSilenceMs);
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

  finalTranscript = "";
  lastInterimText = "";
  lastResultConfidence = 1.0;
  stopResolve = null;
  clearSilenceTimer();

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    callbacks.onError?.("Web Speech API desteklenmiyor");
    return;
  }

  configuredSilenceMs = options?.autoStopAfterSilenceMs ?? 0;

  recognition = new SpeechRecognitionCtor();
  recognition.lang = toBcp47Locale(language);
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onspeechstart = () => {
    resetSilenceTimer();
  };

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        const seg = result[0]?.transcript ?? "";
        if (finalTranscript && !finalTranscript.endsWith(' ') && seg && !seg.startsWith(' ')) {
          finalTranscript += ' ';
        }
        finalTranscript += seg;
        lastResultConfidence = result[0]?.confidence ?? 1.0;
        callbacks.onFinalResult?.(finalTranscript);
      } else {
        interim += result[0]?.transcript ?? "";
      }
    }

    if (interim) {
      lastInterimText = interim;
      callbacks.onInterimResult?.(finalTranscript + interim);
    }

    resetSilenceTimer();
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    console.warn("[WebSpeech] onerror:", event.error);
    if (event.error === "aborted") return;
    callbacks.onError?.(event.error);
  };

  recognition.onend = () => {
    // onend tetiklendi
    recognition = null;
    clearSilenceTimer();

    const resultText = finalTranscript || lastInterimText;
    if (!finalTranscript && lastInterimText) {
      finalTranscript = lastInterimText;
    }

    if (stopResolve) {
      stopResolve(resultText);
      stopResolve = null;
    }
    callbacks.onEnd?.();
  };

  recognition.start();
  resetSilenceTimer();
}

export function stopWebSpeech(): Promise<string> {
  clearSilenceTimer();
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
    }, 2000);
  });
}

export function getFinalTranscript(): string {
  return finalTranscript || lastInterimText;
}

export function getResultConfidence(): number {
  return lastResultConfidence;
}
