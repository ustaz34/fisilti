/**
 * Azure Speech Services streaming servisi.
 * microsoft-cognitiveservices-speech-sdk kullaniyor.
 */

import type { StreamCallbacks } from "./streamCallbacks";

// SDK dinamik import — sadece kullanildiginda yuklenir
let sdk: typeof import("microsoft-cognitiveservices-speech-sdk") | null = null;
let recognizer: import("microsoft-cognitiveservices-speech-sdk").SpeechRecognizer | null = null;
let finalTranscript = "";
let callbacks: StreamCallbacks | null = null;

async function loadSdk() {
  if (!sdk) {
    sdk = await import("microsoft-cognitiveservices-speech-sdk");
  }
  return sdk;
}

function langToAzureLocale(lang: string): string {
  const map: Record<string, string> = {
    tr: "tr-TR", en: "en-US", de: "de-DE", fr: "fr-FR",
    es: "es-ES", it: "it-IT", pt: "pt-BR", ru: "ru-RU",
    ja: "ja-JP", zh: "zh-CN",
  };
  return map[lang] || `${lang}-${lang.toUpperCase()}`;
}

export async function startAzureSpeech(
  key: string,
  region: string,
  language: string,
  cb: StreamCallbacks,
): Promise<void> {
  await stopAzureSpeech();
  finalTranscript = "";
  callbacks = cb;

  try {
    const speechSdk = await loadSdk();
    const speechConfig = speechSdk.SpeechConfig.fromSubscription(key, region);
    speechConfig.speechRecognitionLanguage = langToAzureLocale(language);

    const audioConfig = speechSdk.AudioConfig.fromDefaultMicrophoneInput();
    recognizer = new speechSdk.SpeechRecognizer(speechConfig, audioConfig);

    recognizer.recognizing = (_s, e) => {
      if (e.result.text) {
        callbacks?.onInterimResult?.(
          finalTranscript + (finalTranscript ? " " : "") + e.result.text,
        );
      }
    };

    recognizer.recognized = (_s, e) => {
      if (e.result.reason === speechSdk.ResultReason.RecognizedSpeech && e.result.text) {
        if (finalTranscript && !finalTranscript.endsWith(" ")) {
          finalTranscript += " ";
        }
        finalTranscript += e.result.text;
        callbacks?.onFinalResult?.(finalTranscript);
      }
    };

    recognizer.canceled = (_s, e) => {
      if (e.reason === speechSdk.CancellationReason.Error) {
        callbacks?.onError?.(`Azure hata: ${e.errorDetails}`);
      }
      callbacks?.onEnd?.();
    };

    recognizer.sessionStopped = () => {
      callbacks?.onEnd?.();
    };

    recognizer.startContinuousRecognitionAsync(
      () => { /* basarili */ },
      (err) => { callbacks?.onError?.(`Azure baslatilamadi: ${err}`); },
    );
  } catch (err) {
    callbacks?.onError?.(`Azure SDK hatasi: ${err}`);
  }
}

export function stopAzureSpeech(): Promise<string> {
  return new Promise((resolve) => {
    const result = finalTranscript;

    if (!recognizer) {
      resolve(result);
      return;
    }

    recognizer.stopContinuousRecognitionAsync(
      () => {
        recognizer?.close();
        recognizer = null;
        callbacks = null;
        resolve(finalTranscript || result);
      },
      () => {
        recognizer?.close();
        recognizer = null;
        callbacks = null;
        resolve(finalTranscript || result);
      },
    );
  });
}

export function getAzureTranscript(): string {
  return finalTranscript;
}
