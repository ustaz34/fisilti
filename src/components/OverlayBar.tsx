import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRecordingStore } from "../stores/recordingStore";
import { useTranscriptionStore } from "../stores/transcriptionStore";
import { WaveLine } from "./WaveLine";
import { loadThemeConfig } from "../lib/themeEngine";
import { DEFAULT_CONFIG, type OverlayStyle, type OverlayAnimation, type WaveformStyle, type GlowIntensity } from "../lib/themes";

export function OverlayBar() {
  const { isRecording, duration } = useRecordingStore();
  const { isTranscribing } = useTranscriptionStore();

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
        // waveformStyle localStorage'dan oku (DOM attribute degil)
        const config = loadThemeConfig();
        setWaveformStyle(config.waveformStyle);
      });
      observer.observe(bar, { attributes: true, attributeFilter: ["data-style", "data-anim", "data-glow"] });
      return () => observer.disconnect();
    }
  }, []);

  // Win32 hit-test alanini guncelle: aktifken genis, idle'da kucuk
  useEffect(() => {
    invoke("set_overlay_bar_active", { active: isRecording || isTranscribing }).catch(() => {});
  }, [isRecording, isTranscribing]);

  const status: "idle" | "recording" | "transcribing" = isRecording
    ? "recording"
    : isTranscribing
      ? "transcribing"
      : "idle";

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
