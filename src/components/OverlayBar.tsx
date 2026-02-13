import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useRecordingStore } from "../stores/recordingStore";
import { useTranscriptionStore } from "../stores/transcriptionStore";
import { useTTSStore } from "../stores/ttsStore";
import { WaveLine } from "./WaveLine";
import { loadThemeConfig } from "../lib/themeEngine";
import { DEFAULT_CONFIG, type OverlayStyle, type OverlayAnimation, type WaveformStyle, type GlowIntensity } from "../lib/themes";

export function OverlayBar() {
  const { isRecording, duration } = useRecordingStore();
  const { isTranscribing } = useTranscriptionStore();
  const ttsStatus = useTTSStore((s) => s.status);
  const ttsPreview = useTTSStore((s) => s.previewText);
  const ttsCharIndex = useTTSStore((s) => s.charIndex);
  const ttsTotalChars = useTTSStore((s) => s.totalChars);

  const [overlayStyle, setOverlayStyle] = useState<OverlayStyle>(DEFAULT_CONFIG.overlayStyle);
  const [overlayAnim, setOverlayAnim] = useState<OverlayAnimation>(DEFAULT_CONFIG.overlayAnimation);
  const [waveformStyle, setWaveformStyle] = useState<WaveformStyle>(DEFAULT_CONFIG.waveformStyle);
  const [glowIntensity, setGlowIntensity] = useState<GlowIntensity>(DEFAULT_CONFIG.glowIntensity);

  useEffect(() => {
    const config = loadThemeConfig();
    setOverlayStyle(config.overlayStyle);
    setOverlayAnim(config.overlayAnimation);
    setWaveformStyle(config.waveformStyle);
    setGlowIntensity(config.glowIntensity);
  }, []);

  // theme-changed event'inden tum attributelari guncelle
  useEffect(() => {
    const bar = document.querySelector(".overlay-bar");
    if (bar) {
      const observer = new MutationObserver(() => {
        setOverlayStyle((bar.getAttribute("data-style") as OverlayStyle) ?? DEFAULT_CONFIG.overlayStyle);
        setOverlayAnim((bar.getAttribute("data-anim") as OverlayAnimation) ?? DEFAULT_CONFIG.overlayAnimation);
        setGlowIntensity((bar.getAttribute("data-glow") as GlowIntensity) ?? DEFAULT_CONFIG.glowIntensity);
        const config = loadThemeConfig();
        setWaveformStyle(config.waveformStyle);
      });
      observer.observe(bar, { attributes: true, attributeFilter: ["data-style", "data-anim", "data-glow"] });
      return () => observer.disconnect();
    }
  }, []);

  const isTTSActive = ttsStatus === "speaking" || ttsStatus === "paused" || ttsStatus === "loading";

  // Win32 hit-test alanini guncelle: aktifken genis, idle'da kucuk
  useEffect(() => {
    const setActive = async (active: boolean, retries = 2) => {
      for (let i = 0; i <= retries; i++) {
        try {
          await invoke("set_overlay_bar_active", { active });
          return;
        } catch (err) {
          if (i === retries) console.error("set_overlay_bar_active failed:", err);
          else await new Promise(r => setTimeout(r, 100));
        }
      }
    };
    setActive(isRecording || isTranscribing || isTTSActive);
  }, [isRecording, isTranscribing, isTTSActive]);

  // TTS kontrol fonksiyonlari — event ile main window'a gonder
  const ttsPauseResume = () => {
    if (ttsStatus === "speaking") {
      emit("tts-control", { action: "pause" });
    } else if (ttsStatus === "paused") {
      emit("tts-control", { action: "resume" });
    }
  };
  const ttsStop = () => {
    emit("tts-control", { action: "stop" });
  };

  const ttsProgress = ttsTotalChars > 0 ? (ttsCharIndex / ttsTotalChars) * 100 : 0;

  const status: "idle" | "recording" | "transcribing" = isRecording
    ? "recording"
    : isTranscribing
      ? "transcribing"
      : "idle";

  // TTS aktifken ozel overlay goster
  if (isTTSActive && !isRecording && !isTranscribing) {
    return (
      <div className="overlay-wrap">
        <div
          className={`overlay-bar is-speaking`}
          data-style={overlayStyle}
          data-anim={overlayAnim}
          data-glow={glowIntensity}
          onContextMenu={(e) => {
            e.preventDefault();
            invoke("show_main_window").catch(console.error);
          }}
        >
          {/* TTS overlay icerigi */}
          <div className="tts-overlay">
            {/* Sol: hoparlor ikonu */}
            <div className={`tts-overlay-icon ${ttsStatus === "loading" ? "is-loading" : ttsStatus === "paused" ? "is-paused" : ""}`}>
              {ttsStatus === "loading" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="tts-overlay-spinner">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              )}
            </div>

            {/* Orta: metin onizleme */}
            <div className="tts-overlay-text">
              <span className="tts-overlay-label">
                {ttsStatus === "loading" ? "Hazırlanıyor..." : ttsStatus === "paused" ? "Duraklatıldı" : ttsPreview || "Seslendiriliyor..."}
              </span>
            </div>

            {/* Sag: kontroller */}
            {ttsStatus !== "loading" && (
              <div className="tts-overlay-controls">
                <button className="tts-overlay-btn" onClick={ttsPauseResume} title={ttsStatus === "paused" ? "Devam" : "Duraklat"}>
                  {ttsStatus === "paused" ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                  )}
                </button>
                <button className="tts-overlay-btn tts-overlay-btn--stop" onClick={ttsStop} title="Durdur">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                </button>
              </div>
            )}
          </div>

          {/* Alt: ilerleme cubugu */}
          <div className="tts-overlay-progress">
            <div
              className={`tts-overlay-progress-fill ${ttsStatus === "loading" ? "is-loading" : ""}`}
              style={{ width: ttsStatus === "loading" ? "100%" : `${ttsProgress}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-wrap">
      <div
        className={`overlay-bar ${isRecording ? "is-recording" : isTranscribing ? "is-transcribing" : ""}`}
        data-style={overlayStyle}
        data-anim={overlayAnim}
        data-glow={glowIntensity}
        onContextMenu={(e) => {
          e.preventDefault();
          invoke("show_main_window").catch(console.error);
        }}
      >
        {/* Dalga formu */}
        <div className="bar-wave">
          <WaveLine status={status} waveformStyle={waveformStyle} />
        </div>

        {/* Sure (sadece kayit sirasinda) */}
        {isRecording && (
          <div className="bar-timer">
            <span className="text-[9px] font-medium text-[rgba(var(--accent-rgb),0.5)] tabular-nums tracking-wide">
              {duration}s
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
