import { useState, useEffect } from "react";
import {
  PALETTES,
  OVERLAY_STYLES,
  OVERLAY_ANIMATIONS,
  WAVEFORM_STYLES,
  GLOW_INTENSITIES,
  type ThemeConfig,
} from "../lib/themes";
import {
  loadThemeConfig,
  applyAndBroadcastTheme,
} from "../lib/themeEngine";

export function ColorsPanel() {
  const [config, setConfig] = useState<ThemeConfig>(() => loadThemeConfig());

  useEffect(() => {
    setConfig(loadThemeConfig());
  }, []);

  const update = (partial: Partial<ThemeConfig>) => {
    const next = { ...config, ...partial };
    setConfig(next);
    applyAndBroadcastTheme(next);
  };

  return (
    <div className="cp-root">
      {/* ── Renk Paleti ── */}
      <div className="cp-section">
        <div className="cp-section-head">
          <div className="cp-section-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="13.5" cy="6.5" r="2.5"/>
              <circle cx="17.5" cy="10.5" r="2.5"/>
              <circle cx="8.5" cy="7.5" r="2.5"/>
              <circle cx="6.5" cy="12.5" r="2.5"/>
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-9-10-9z"/>
            </svg>
          </div>
          <span className="cp-section-title">Renk Paleti</span>
          <div className="cp-section-line" />
        </div>

        <div className="cp-palette-grid">
          {PALETTES.map((palette) => {
            const isActive = palette.id === config.paletteId;
            return (
              <button
                key={palette.id}
                className={`cp-palette-card ${isActive ? "cp-palette-card--active" : ""}`}
                onClick={() => update({ paletteId: palette.id })}
              >
                {isActive && (
                  <div className="cp-palette-check">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </div>
                )}
                <div className="cp-swatches">
                  {palette.colors.map((color, i) => (
                    <div
                      key={i}
                      className="cp-swatch"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <span className="cp-palette-name">{palette.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Overlay Stili ── */}
      <div className="cp-section">
        <div className="cp-section-head">
          <div className="cp-section-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 15h18" />
            </svg>
          </div>
          <span className="cp-section-title">Overlay Stili</span>
          <div className="cp-section-line" />
        </div>

        <div className="cp-style-grid">
          {OVERLAY_STYLES.map((style) => {
            const isActive = style.id === config.overlayStyle;
            return (
              <button
                key={style.id}
                className={`cp-style-card ${isActive ? "cp-style-card--active" : ""}`}
                onClick={() => update({ overlayStyle: style.id })}
              >
                <div className="cp-style-preview">
                  <div className={`cp-style-bar ${style.id !== "default" ? `cp-style-bar--${style.id}` : ""}`} />
                </div>
                <span className="cp-style-name">{style.name}</span>
                <span className="cp-style-desc">{style.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Acilis Animasyonu ── */}
      <div className="cp-section">
        <div className="cp-section-head">
          <div className="cp-section-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
          <span className="cp-section-title">Acilis Animasyonu</span>
          <div className="cp-section-line" />
        </div>

        <div className="cp-option-grid">
          {OVERLAY_ANIMATIONS.map((anim) => {
            const isActive = anim.id === config.overlayAnimation;
            return (
              <button
                key={anim.id}
                className={`cp-option-card ${isActive ? "cp-option-card--active" : ""}`}
                onClick={() => update({ overlayAnimation: anim.id })}
              >
                <span className="cp-option-name">{anim.name}</span>
                <span className="cp-option-desc">{anim.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Dalga Stili ── */}
      <div className="cp-section">
        <div className="cp-section-head">
          <div className="cp-section-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12c2-3 4-6 6-3s4 6 6 3 4-6 6-3" />
            </svg>
          </div>
          <span className="cp-section-title">Dalga Stili</span>
          <div className="cp-section-line" />
        </div>

        <div className="cp-option-grid">
          {WAVEFORM_STYLES.map((wave) => {
            const isActive = wave.id === config.waveformStyle;
            return (
              <button
                key={wave.id}
                className={`cp-option-card ${isActive ? "cp-option-card--active" : ""}`}
                onClick={() => update({ waveformStyle: wave.id })}
              >
                <span className="cp-option-name">{wave.name}</span>
                <span className="cp-option-desc">{wave.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Parlaklik ── */}
      <div className="cp-section">
        <div className="cp-section-head">
          <div className="cp-section-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </div>
          <span className="cp-section-title">Parlaklik</span>
          <div className="cp-section-line" />
        </div>

        <div className="cp-option-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {GLOW_INTENSITIES.map((glow) => {
            const isActive = glow.id === config.glowIntensity;
            return (
              <button
                key={glow.id}
                className={`cp-option-card ${isActive ? "cp-option-card--active" : ""}`}
                onClick={() => update({ glowIntensity: glow.id })}
              >
                <span className="cp-option-name">{glow.name}</span>
                <span className="cp-option-desc">{glow.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
