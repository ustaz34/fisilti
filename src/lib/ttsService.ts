import { useTTSStore, type TTSVoice } from "../stores/ttsStore";
import { synthesizeEdgeTTS, getEdgeVoices, getEdgeTurkishVoices } from "./edgeTTSService";
import { emit } from "@tauri-apps/api/event";

const MAX_CHUNK_LENGTH = 4000;

class TTSService {
  private static instance: TTSService;
  private synth: SpeechSynthesis;

  // Browser engine state
  private chunks: string[] = [];
  private currentChunkIndex = 0;
  private isStopping = false;

  // Edge engine state
  private audioElement: HTMLAudioElement | null = null;
  private audioBlobUrl: string | null = null;

  private constructor() {
    this.synth = window.speechSynthesis;
    this.loadBrowserVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this.loadBrowserVoices();
    }
    // Edge seslerini arka planda yukle
    this.loadEdgeVoices();
  }

  static getInstance(): TTSService {
    if (!TTSService.instance) {
      TTSService.instance = new TTSService();
    }
    return TTSService.instance;
  }

  private loadBrowserVoices() {
    const rawVoices = this.synth.getVoices();
    const voices: TTSVoice[] = rawVoices.map((v) => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
    }));
    const turkishVoices = voices.filter(
      (v) => v.lang.startsWith("tr") || v.lang.startsWith("TR")
    );
    useTTSStore.getState().setVoices(voices, turkishVoices);
  }

  private async loadEdgeVoices() {
    try {
      const voices = await getEdgeVoices();
      const turkishVoices = await getEdgeTurkishVoices();
      useTTSStore.getState().setEdgeVoices(voices, turkishVoices);
    } catch (e) {
      console.warn("Edge TTS ses listesi yuklenemedi:", e);
    }
  }

  // ─── Unified API ───

  async speak(text: string) {
    if (!text.trim()) return;
    this.stop();
    this.isStopping = false;

    const store = useTTSStore.getState();
    store.setCurrentText(text);

    if (store.settings.engine === "edge") {
      await this.speakEdge(text);
    } else {
      this.speakBrowser(text);
    }
  }

  pause() {
    const engine = useTTSStore.getState().settings.engine;
    if (engine === "edge") {
      if (this.audioElement && !this.audioElement.paused) {
        this.audioElement.pause();
        useTTSStore.getState().setStatus("paused");
        this.emitStatus("paused");
      }
    } else {
      if (this.synth.speaking && !this.synth.paused) {
        this.synth.pause();
        useTTSStore.getState().setStatus("paused");
        this.emitStatus("paused");
      }
    }
  }

  resume() {
    const engine = useTTSStore.getState().settings.engine;
    if (engine === "edge") {
      if (this.audioElement?.paused) {
        this.audioElement.play();
        useTTSStore.getState().setStatus("speaking");
        this.emitStatus("speaking");
      }
    } else {
      if (this.synth.paused) {
        this.synth.resume();
        useTTSStore.getState().setStatus("speaking");
        this.emitStatus("speaking");
      }
    }
  }

  stop() {
    this.isStopping = true;
    // Browser engine
    this.synth.cancel();
    this.chunks = [];
    this.currentChunkIndex = 0;
    // Edge engine
    this.edgeChunks = [];
    this.edgeChunkIndex = 0;
    this.cleanupAudio();
    useTTSStore.getState().reset();
    this.emitStatus("idle");
  }

  // ─── Browser Engine (speechSynthesis) ───

  private speakBrowser(text: string) {
    const store = useTTSStore.getState();
    store.setStatus("speaking");
    this.emitStatus("speaking");

    this.chunks = this.splitTextIntoChunks(text);
    this.currentChunkIndex = 0;
    this.speakNextBrowserChunk();
  }

  private speakNextBrowserChunk() {
    if (this.isStopping) return;
    if (this.currentChunkIndex >= this.chunks.length) {
      this.onBrowserComplete();
      return;
    }

    const chunk = this.chunks[this.currentChunkIndex];
    const utterance = new SpeechSynthesisUtterance(chunk);

    const { settings } = useTTSStore.getState();
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;

    if (settings.selectedVoice) {
      const rawVoices = this.synth.getVoices();
      const voice = rawVoices.find((v) => v.voiceURI === settings.selectedVoice);
      if (voice) utterance.voice = voice;
    }

    const chunkOffset = this.chunks
      .slice(0, this.currentChunkIndex)
      .reduce((acc, c) => acc + c.length, 0);

    utterance.onboundary = (event) => {
      const globalIndex = chunkOffset + event.charIndex;
      const store = useTTSStore.getState();
      store.setProgress(globalIndex, store.totalChars);
    };

    utterance.onend = () => {
      if (this.isStopping) return;
      this.currentChunkIndex++;
      this.speakNextBrowserChunk();
    };

    utterance.onerror = (event) => {
      if (event.error === "canceled" || event.error === "interrupted") return;
      console.error("TTS hatasi:", event.error);
      this.onBrowserComplete();
    };

    this.synth.speak(utterance);
  }

  private onBrowserComplete() {
    const store = useTTSStore.getState();
    store.setStatus("idle");
    store.setProgress(store.totalChars, store.totalChars);
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.emitStatus("idle");
  }

  // ─── Edge TTS Engine ───

  // Edge TTS icin metin parcalama (uzun metinlerde WebSocket zaman asimini onler)
  private edgeChunks: string[] = [];
  private edgeChunkIndex = 0;

  private async speakEdge(text: string) {
    const store = useTTSStore.getState();

    store.setStatus("loading");
    this.emitStatus("loading");

    // Metni cumlelere bol (Edge TTS icin ~2000 karakter siniri guvenli)
    this.edgeChunks = this.splitTextIntoChunks(text);
    this.edgeChunkIndex = 0;

    await this.playNextEdgeChunk();
  }

  private async playNextEdgeChunk() {
    if (this.isStopping) return;
    if (this.edgeChunkIndex >= this.edgeChunks.length) {
      // Tum parcalar bitti
      useTTSStore.getState().reset();
      this.emitStatus("idle");
      this.cleanupAudio();
      return;
    }

    const chunk = this.edgeChunks[this.edgeChunkIndex];
    const { settings } = useTTSStore.getState();

    try {
      const voice = settings.selectedVoice || "tr-TR-EmelNeural";
      console.log(`[TTS] Edge chunk ${this.edgeChunkIndex + 1}/${this.edgeChunks.length}: ${chunk.length} karakter`);

      const blob = await synthesizeEdgeTTS(
        chunk,
        voice,
        settings.rate,
        settings.pitch,
        settings.volume
      );

      if (this.isStopping) return;

      // Bos audio kontrolu
      if (blob.size < 100) {
        console.warn("[TTS] Edge TTS bos/cok kucuk audio dondurdu, sonraki parcaya geciliyor");
        this.edgeChunkIndex++;
        await this.playNextEdgeChunk();
        return;
      }

      this.cleanupAudio();
      this.audioBlobUrl = URL.createObjectURL(blob);
      this.audioElement = new Audio(this.audioBlobUrl);

      this.audioElement.onplay = () => {
        useTTSStore.getState().setStatus("speaking");
        this.emitStatus("speaking");
      };

      this.audioElement.ontimeupdate = () => {
        if (this.audioElement) {
          const pct = this.audioElement.currentTime / (this.audioElement.duration || 1);
          const chunkOffset = this.edgeChunks
            .slice(0, this.edgeChunkIndex)
            .reduce((acc, c) => acc + c.length, 0);
          const total = useTTSStore.getState().totalChars;
          const globalPct = (chunkOffset + pct * chunk.length) / (total || 1);
          useTTSStore.getState().setProgress(Math.round(globalPct * total), total);
        }
      };

      this.audioElement.onended = () => {
        if (this.isStopping) return;
        this.edgeChunkIndex++;
        this.playNextEdgeChunk();
      };

      this.audioElement.onerror = (e) => {
        console.error("[TTS] Audio oynatma hatasi:", e);
        // Hata olursa sonraki parcayi dene
        if (!this.isStopping && this.edgeChunkIndex < this.edgeChunks.length - 1) {
          this.edgeChunkIndex++;
          this.playNextEdgeChunk();
        } else {
          useTTSStore.getState().reset();
          this.emitStatus("idle");
          this.cleanupAudio();
        }
      };

      await this.audioElement.play();
    } catch (e) {
      console.error("[TTS] Edge TTS sentez hatasi:", e);
      // Hata olursa sonraki parcayi dene
      if (!this.isStopping && this.edgeChunkIndex < this.edgeChunks.length - 1) {
        this.edgeChunkIndex++;
        await this.playNextEdgeChunk();
      } else {
        useTTSStore.getState().reset();
        this.emitStatus("idle");
      }
    }
  }

  private cleanupAudio() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.removeAttribute("src");
      this.audioElement.load();
      this.audioElement = null;
    }
    if (this.audioBlobUrl) {
      URL.revokeObjectURL(this.audioBlobUrl);
      this.audioBlobUrl = null;
    }
  }

  // ─── Helpers ───

  private splitTextIntoChunks(text: string): string[] {
    if (text.length <= MAX_CHUNK_LENGTH) return [text];
    const chunks: string[] = [];
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    let current = "";
    for (const sentence of sentences) {
      if ((current + sentence).length > MAX_CHUNK_LENGTH && current.length > 0) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current += sentence;
      }
    }
    if (current.trim().length > 0) {
      chunks.push(current.trim());
    }
    return chunks;
  }

  private emitStatus(status: string) {
    const store = useTTSStore.getState();
    const text = store.currentText || "";
    const preview = text.length > 60 ? text.slice(0, 57) + "..." : text;
    emit("tts-status-changed", {
      status,
      text: preview,
      charIndex: store.charIndex,
      totalChars: store.totalChars,
    }).catch(() => {});
  }
}

export function getTTSService(): TTSService {
  return TTSService.getInstance();
}
