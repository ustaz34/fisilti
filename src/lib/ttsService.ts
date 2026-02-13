import { useTTSStore, type TTSVoice } from "../stores/ttsStore";
import { synthesizeEdgeTTS, synthesizeEdgeTTSWithBoundaries, getEdgeVoices, getEdgeTurkishVoices, type WordBoundary } from "./edgeTTSService";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

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

  // Word boundary tracking
  private edgeWordBoundaries: WordBoundary[] = [];
  private edgeChunkCharOffsets: number[] = []; // her chunk'un global karakter offset'i
  private trackingInterval: number | null = null; // yuksek frekanslı kelime takip dongusu
  private lastHighlightedOffset = -1; // ayni pozisyonu tekrar gondermeyi onle
  private lastSentenceIndex = -1; // cumle hassasiyeti icin
  private isRestarting = false; // speak() icinden stop() cagirildiginda UIA temizligini atla

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

  async speak(text: string, readAlong?: boolean) {
    if (!text.trim()) return;
    this.isRestarting = true;
    this.stop();
    this.isRestarting = false;
    this.isStopping = false;

    const store = useTTSStore.getState();
    store.setCurrentText(text);
    // Overlay penceresine de metni gonder (ayri WebView, ayri store)
    emit("tts-text-set", { text }).catch(() => {});

    // Kisayol ile tetiklendiginde mod "off" ise otomatik olarak "source" yap
    if (readAlong && store.settings.readAlongMode === "off") {
      useTTSStore.getState().updateTTSSettings({ readAlongMode: "source" });
      console.debug("[TTS] readAlongMode otomatik olarak 'source' yapildi");
    }

    // UIA init artik Rust tarafinda yapiliyor (trigger_tts_read icinde, fokus kaynak uygulamadayken)
    // readAlongSupported SettingsApp.tsx event handler'inda set ediliyor
    if (readAlong) {
      console.debug("[TTS] Read-along aktif, UIA destegi:", useTTSStore.getState().readAlongSupported);
    }

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
    this.edgeWordBoundaries = [];
    this.edgeChunkCharOffsets = [];
    this.lastSentenceIndex = -1;
    this.lastHighlightedOffset = -1;
    this.stopWordTracking();
    this.cleanupAudio();
    // Read-along durdur — yeni oturum baslatilirken (isRestarting) temizlik yapma
    // cunku UIA konteksti Rust tarafinda zaten kurulmus/kurulacak
    if (!this.isRestarting && useTTSStore.getState().settings.readAlongMode !== "off") {
      invoke("uia_stop_read_along").catch(() => {});
    }
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

      // Read-along: browser engine word boundary
      if (event.name === "word" && store.settings.readAlongMode !== "off") {
        const wordLen = event.charLength || 1;
        const word = chunk.slice(event.charIndex, event.charIndex + wordLen);
        const globalOffset = chunkOffset + event.charIndex;
        this.handleWordBoundary(word, globalOffset, wordLen);
      }
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
    if (store.settings.readAlongMode !== "off") {
      invoke("uia_stop_read_along").catch(() => {});
    }
    this.stopWordTracking();
    store.setStatus("idle");
    store.setProgress(store.totalChars, store.totalChars);
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.lastSentenceIndex = -1;
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
    this.edgeWordBoundaries = [];
    this.lastSentenceIndex = -1;

    // Chunk char offset'lerini hesapla
    this.edgeChunkCharOffsets = [];
    let offset = 0;
    for (const c of this.edgeChunks) {
      this.edgeChunkCharOffsets.push(offset);
      offset += c.length;
    }

    await this.playNextEdgeChunk();
  }

  private async playNextEdgeChunk() {
    if (this.isStopping) return;
    if (this.edgeChunkIndex >= this.edgeChunks.length) {
      // Tum parcalar bitti
      if (useTTSStore.getState().settings.readAlongMode !== "off") {
        invoke("uia_stop_read_along").catch(() => {});
      }
      this.stopWordTracking();
      this.edgeWordBoundaries = [];
      this.lastSentenceIndex = -1;
      this.lastHighlightedOffset = -1;
      useTTSStore.getState().reset();
      this.emitStatus("idle");
      this.cleanupAudio();
      return;
    }

    const chunk = this.edgeChunks[this.edgeChunkIndex];
    const { settings } = useTTSStore.getState();

    try {
      const voice = settings.selectedVoice || "tr-TR-EmelNeural";
      const readAlongMode = settings.readAlongMode;
      const useReadAlong = readAlongMode !== "off";
      console.debug(`[TTS] Edge chunk ${this.edgeChunkIndex + 1}/${this.edgeChunks.length}: ${chunk.length} karakter, readAlong=${readAlongMode}`);

      let blob: Blob;
      let chunkBoundaries: import("./edgeTTSService").WordBoundary[] = [];

      if (useReadAlong) {
        const result = await synthesizeEdgeTTSWithBoundaries(
          chunk, voice, settings.rate, settings.pitch, settings.volume
        );
        blob = result.blob;
        chunkBoundaries = result.wordBoundaries;
      } else {
        blob = await synthesizeEdgeTTS(
          chunk, voice, settings.rate, settings.pitch, settings.volume
        );
      }

      if (this.isStopping) return;

      // Bos audio kontrolu
      if (blob.size < 100) {
        console.warn("[TTS] Edge TTS bos/cok kucuk audio dondurdu, sonraki parcaya geciliyor");
        this.edgeChunkIndex++;
        await this.playNextEdgeChunk();
        return;
      }

      // Bu chunk'in word boundary'lerini sakla
      this.edgeWordBoundaries = chunkBoundaries;

      this.cleanupAudio();
      this.audioBlobUrl = URL.createObjectURL(blob);
      this.audioElement = new Audio(this.audioBlobUrl);

      const chunkGlobalOffset = this.edgeChunkCharOffsets[this.edgeChunkIndex] || 0;

      this.audioElement.onplay = () => {
        useTTSStore.getState().setStatus("speaking");
        this.emitStatus("speaking");
        // Yuksek frekanslı kelime takip dongusunu baslat
        if (useReadAlong) {
          this.startWordTracking(chunkGlobalOffset);
        }
      };

      this.audioElement.ontimeupdate = () => {
        if (this.audioElement) {
          const currentTime = this.audioElement.currentTime;
          const duration = this.audioElement.duration || 1;
          const pct = currentTime / duration;
          const total = useTTSStore.getState().totalChars;
          const globalPct = (chunkGlobalOffset + pct * chunk.length) / (total || 1);
          useTTSStore.getState().setProgress(Math.round(globalPct * total), total);
        }
      };

      this.audioElement.onended = () => {
        if (this.isStopping) return;
        this.stopWordTracking();
        this.lastHighlightedOffset = -1;
        this.edgeChunkIndex++;
        this.edgeWordBoundaries = [];
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

  // ─── Read-Along Helpers ───

  /**
   * Yuksek frekanslı (30ms) kelime takip dongusu baslat.
   * ontimeupdate (~250ms) yerine bu dongu kullanilarak daha akici vurgulama saglanir.
   */
  private startWordTracking(chunkGlobalOffset: number) {
    this.stopWordTracking();
    if (this.edgeWordBoundaries.length === 0) return;

    this.trackingInterval = window.setInterval(() => {
      if (!this.audioElement || this.audioElement.paused || this.isStopping) return;

      const currentTicks = this.audioElement.currentTime * 10_000_000;
      // Binary search yerine ters linear scan — boundary sayisi genelde <50
      let matched: WordBoundary | null = null;
      for (let i = this.edgeWordBoundaries.length - 1; i >= 0; i--) {
        if (this.edgeWordBoundaries[i].audio_offset_ticks <= currentTicks) {
          matched = this.edgeWordBoundaries[i];
          break;
        }
      }
      if (matched) {
        const globalOffset = chunkGlobalOffset + matched.text_offset;
        this.handleWordBoundary(matched.text, globalOffset, matched.text_length);
      }
    }, 30); // ~33 fps — akici takip
  }

  private stopWordTracking() {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval);
      this.trackingInterval = null;
    }
  }

  private handleWordBoundary(
    word: string,
    globalOffset: number,
    wordLength: number,
  ) {
    // Ayni pozisyonu tekrar isleme — dedup
    if (globalOffset === this.lastHighlightedOffset) return;
    this.lastHighlightedOffset = globalOffset;

    const store = useTTSStore.getState();
    const mode = store.settings.readAlongMode;
    const granularity = store.settings.readAlongGranularity;

    if (granularity === "sentence") {
      // Cumle hassasiyeti: tum cumleyi vurgula
      const bounds = this.findSentenceBounds(globalOffset, store.currentText);
      if (bounds.index === this.lastSentenceIndex) return;
      this.lastSentenceIndex = bounds.index;

      if ((mode === "source" || mode === "both") && store.readAlongSupported) {
        invoke("uia_highlight_word", { charOffset: bounds.start, charLength: bounds.length }).catch(() => {});
      }
      if (mode === "overlay" || mode === "both") {
        const sentenceText = store.currentText.slice(bounds.start, bounds.start + bounds.length);
        store.setCurrentWord(sentenceText, bounds.start, bounds.length);
        // Overlay penceresine de gonder (ayri WebView)
        emit("tts-word-update", { word: sentenceText, offset: bounds.start, length: bounds.length }).catch(() => {});
      }
      return;
    }

    // Kelime hassasiyeti
    if ((mode === "source" || mode === "both") && store.readAlongSupported) {
      invoke("uia_highlight_word", { charOffset: globalOffset, charLength: wordLength }).catch(() => {});
    }
    if (mode === "overlay" || mode === "both") {
      store.setCurrentWord(word, globalOffset, wordLength);
      // Overlay penceresine de gonder (ayri WebView)
      emit("tts-word-update", { word, offset: globalOffset, length: wordLength }).catch(() => {});
    }
  }

  /**
   * Verilen karakter offset'inin icinde bulundugu cumlenin sinirlarini dondurur.
   */
  private findSentenceBounds(charOffset: number, fullText: string): { index: number; start: number; length: number } {
    const enders = /[.!?;]/;
    let sentenceIdx = 0;
    let sentenceStart = 0;

    // charOffset'ten onceki cumle sinirlarini tara
    for (let i = 0; i < fullText.length && i < charOffset; i++) {
      if (enders.test(fullText[i])) {
        sentenceIdx++;
        sentenceStart = i + 1;
        // Noktalama sonrasi bosluklari atla
        while (sentenceStart < fullText.length && /\s/.test(fullText[sentenceStart])) {
          sentenceStart++;
        }
      }
    }

    // Cumlenin sonunu bul
    let sentenceEnd = fullText.length;
    for (let i = Math.max(sentenceStart, charOffset); i < fullText.length; i++) {
      if (enders.test(fullText[i])) {
        sentenceEnd = i + 1; // noktalamayi dahil et
        break;
      }
    }

    return {
      index: sentenceIdx,
      start: sentenceStart,
      length: sentenceEnd - sentenceStart,
    };
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
      readAlongMode: store.settings.readAlongMode,
    }).catch(() => {});
  }
}

export function getTTSService(): TTSService {
  return TTSService.getInstance();
}
