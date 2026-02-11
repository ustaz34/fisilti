import { emit, listen } from "@tauri-apps/api/event";
import {
  type ThemeConfig,
  type ThemePalette,
  DEFAULT_CONFIG,
  getPaletteById,
  hexToRgb,
  setAccentRgbCache,
} from "./themes";

const STORAGE_KEY = "fisilti-theme";

export function loadThemeConfig(): ThemeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Eski config'lerde yeni alanlar eksik olabilir, default ile birlestir
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

export function saveThemeConfig(config: ThemeConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function applyPalette(palette: ThemePalette) {
  const root = document.documentElement;
  const s = root.style;

  const accent = hexToRgb(palette.accent);
  const bg = hexToRgb(palette.bgPrimary);

  s.setProperty("--color-bg-primary", palette.bgPrimary);
  s.setProperty("--color-bg-dark", palette.bgDark);
  s.setProperty("--color-bg-darker", palette.bgDarker);
  s.setProperty("--color-accent", palette.accent);
  s.setProperty("--color-accent-hover", palette.accentHover);
  s.setProperty("--color-recording", palette.accent);
  s.setProperty("--color-text-primary", palette.textPrimary);
  s.setProperty("--color-text-secondary", palette.textSecondary);
  s.setProperty("--color-text-muted", palette.textMuted);

  s.setProperty("--accent-rgb", `${accent.r}, ${accent.g}, ${accent.b}`);
  s.setProperty("--bg-primary-rgb", `${bg.r}, ${bg.g}, ${bg.b}`);

  s.setProperty("--color-bg-overlay", `rgba(${bg.r}, ${bg.g}, ${bg.b}, 0.95)`);
  s.setProperty("--color-glass", `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.04)`);
  s.setProperty("--color-glass-border", `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.10)`);
  s.setProperty("--color-glass-hover", `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.08)`);

  setAccentRgbCache(accent.r, accent.g, accent.b);
}

export function applyOverlayAttributes(config: ThemeConfig) {
  const bar = document.querySelector(".overlay-bar");
  if (bar) {
    bar.setAttribute("data-style", config.overlayStyle);
    bar.setAttribute("data-anim", config.overlayAnimation);
    bar.setAttribute("data-glow", config.glowIntensity);
  }
}

export async function applyAndBroadcastTheme(config: ThemeConfig) {
  const palette = getPaletteById(config.paletteId);
  applyPalette(palette);
  applyOverlayAttributes(config);
  saveThemeConfig(config);
  try {
    await emit("theme-changed", config);
  } catch {
    // overlay penceresi kapali olabilir
  }
}

export function initThemeOnStartup() {
  const config = loadThemeConfig();
  const palette = getPaletteById(config.paletteId);
  applyPalette(palette);
}

export function listenThemeChanges(callback?: () => void) {
  return listen<ThemeConfig>("theme-changed", (event) => {
    const config = event.payload;
    const palette = getPaletteById(config.paletteId);
    applyPalette(palette);
    applyOverlayAttributes(config);
    saveThemeConfig(config);
    callback?.();
  });
}
