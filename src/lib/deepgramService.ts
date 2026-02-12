/**
 * Deepgram Nova-3 WebSocket streaming servisi.
 * Dogrudan tarayici WebSocket API kullanir — SDK gereksiz.
 */

import type { StreamCallbacks } from "./streamCallbacks";

let ws: WebSocket | null = null;
let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let finalTranscript = "";
let callbacks: StreamCallbacks | null = null;

export function startDeepgram(
  apiKey: string,
  language: string,
  cb: StreamCallbacks,
): void {
  // Onceki oturumu temizle
  cleanup();
  finalTranscript = "";
  callbacks = cb;

  const lang = language || "tr";
  const url =
    `wss://api.deepgram.com/v1/listen?model=nova-3&language=${lang}&punctuate=true&smart_format=true&interim_results=true`;

  ws = new WebSocket(url, ["token", apiKey]);

  ws.onopen = async () => {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType: "audio/webm;codecs=opus" });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws?.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      mediaRecorder.start(250); // 250ms chunk'lar
    } catch (err) {
      callbacks?.onError?.(`Mikrofon hatasi: ${err}`);
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "Results") {
        const alt = data.channel?.alternatives?.[0];
        if (!alt) return;

        const transcript = alt.transcript || "";
        if (!transcript) return;

        if (data.is_final) {
          if (finalTranscript && !finalTranscript.endsWith(" ") && !transcript.startsWith(" ")) {
            finalTranscript += " ";
          }
          finalTranscript += transcript;
          callbacks?.onFinalResult?.(finalTranscript);
        } else {
          callbacks?.onInterimResult?.(finalTranscript + (finalTranscript ? " " : "") + transcript);
        }
      }
    } catch {
      // JSON parse hatasi — devam et
    }
  };

  ws.onerror = () => {
    callbacks?.onError?.("Deepgram baglanti hatasi");
  };

  ws.onclose = (event) => {
    if (event.code !== 1000 && event.code !== 1001) {
      callbacks?.onError?.(`Deepgram baglanti kapandi: ${event.code}`);
    }
    callbacks?.onEnd?.();
  };
}

export function stopDeepgram(): Promise<string> {
  return new Promise((resolve) => {
    const result = finalTranscript;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      // Deepgram'a kapanma sinyali gonder
      try {
        ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch {
        // WebSocket zaten kapanmis olabilir
      }
      // Kisa bir bekleme ile son sonuclarin gelmesini sagla
      setTimeout(() => {
        cleanup();
        resolve(finalTranscript || result);
      }, 500);
    } else {
      cleanup();
      resolve(result);
    }
  });
}

function cleanup() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    try { mediaRecorder.stop(); } catch { /* */ }
  }
  mediaRecorder = null;

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  if (ws) {
    try { ws.close(); } catch { /* */ }
    ws = null;
  }

  callbacks = null;
}

export function getDeepgramTranscript(): string {
  return finalTranscript;
}
