// ── Tema Tanimlari ──

export interface ThemePalette {
  id: string;
  name: string;
  colors: [string, string, string, string];
  bgPrimary: string;
  bgDark: string;
  bgDarker: string;
  accent: string;
  accentHover: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
}

export type OverlayStyle = "default" | "pill" | "neon" | "minimal" | "glass" | "wave" | "frost" | "ember" | "sharp" | "float";
export type OverlayAnimation = "smooth" | "bounce" | "slide" | "scale" | "elastic" | "snap" | "drop" | "twist" | "fade" | "ripple";
export type WaveformStyle = "classic" | "thin" | "thick" | "pulse" | "mirror" | "bars" | "dot" | "helix" | "spectrum" | "scatter" | "zigzag" | "orbit";
export type GlowIntensity = "none" | "subtle" | "medium" | "intense";
export type SoundPack = "varsayilan" | "kristal" | "mekanik" | "yumusak" | "bip" | "tok" | "pop" | "zil" | "dalga" | "sessiz";

export interface ThemeConfig {
  paletteId: string;
  overlayStyle: OverlayStyle;
  overlayAnimation: OverlayAnimation;
  waveformStyle: WaveformStyle;
  glowIntensity: GlowIntensity;
  soundPack: SoundPack;
}

export const DEFAULT_CONFIG: ThemeConfig = {
  paletteId: "varsayilan",
  overlayStyle: "default",
  overlayAnimation: "smooth",
  waveformStyle: "classic",
  glowIntensity: "medium",
  soundPack: "varsayilan",
};

// ── Accent RGB Cache (Canvas bilesenleri icin) ──

let _accentR = 250;
let _accentG = 228;
let _accentB = 207;

export function setAccentRgbCache(r: number, g: number, b: number) {
  _accentR = r;
  _accentG = g;
  _accentB = b;
}

export function accentRgba(opacity: number): string {
  return `rgba(${_accentR}, ${_accentG}, ${_accentB}, ${opacity})`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 250, g: 228, b: 207 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

// ── 14 Kurated Palet ──

export const PALETTES: ThemePalette[] = [
  {
    id: "varsayilan",
    name: "Varsayilan",
    colors: ["#fae4cf", "#0a0f23", "#080d1e", "#e8e0d8"],
    bgPrimary: "#0a0f23",
    bgDark: "#080d1e",
    bgDarker: "#060a19",
    accent: "#fae4cf",
    accentHover: "#f5d4b5",
    textPrimary: "#e8e0d8",
    textSecondary: "#a09890",
    textMuted: "#4a4540",
  },
  {
    id: "okyanus",
    name: "Okyanus",
    colors: ["#7AB2B2", "#0a1a1f", "#CDE8E5", "#4D869C"],
    bgPrimary: "#0a1a1f",
    bgDark: "#071517",
    bgDarker: "#050f11",
    accent: "#7AB2B2",
    accentHover: "#8FC4C4",
    textPrimary: "#CDE8E5",
    textSecondary: "#7A9E9E",
    textMuted: "#3A5555",
  },
  {
    id: "gece",
    name: "Gece",
    colors: ["#DFD0B8", "#222831", "#393E46", "#948979"],
    bgPrimary: "#222831",
    bgDark: "#1a1f27",
    bgDarker: "#14181e",
    accent: "#DFD0B8",
    accentHover: "#EAE0CC",
    textPrimary: "#E8E2DA",
    textSecondary: "#948979",
    textMuted: "#555049",
  },
  {
    id: "amber",
    name: "Amber",
    colors: ["#FAB95B", "#1A3263", "#E09145", "#FDD98A"],
    bgPrimary: "#1A3263",
    bgDark: "#142850",
    bgDarker: "#0f1e3d",
    accent: "#FAB95B",
    accentHover: "#FBCA7C",
    textPrimary: "#F0E4D4",
    textSecondary: "#A09070",
    textMuted: "#504830",
  },
  {
    id: "neon-mor",
    name: "Neon Mor",
    colors: ["#5B23FF", "#1a1630", "#8B5CF6", "#C4B5FD"],
    bgPrimary: "#1a1630",
    bgDark: "#141028",
    bgDarker: "#0e0b1f",
    accent: "#5B23FF",
    accentHover: "#7B4FFF",
    textPrimary: "#E0D8F0",
    textSecondary: "#8878A8",
    textMuted: "#4A3E60",
  },
  {
    id: "neon-pembe",
    name: "Neon Pembe",
    colors: ["#FF0087", "#1a0a15", "#FF69B4", "#FFB6D9"],
    bgPrimary: "#1a0a15",
    bgDark: "#140810",
    bgDarker: "#0e060c",
    accent: "#FF0087",
    accentHover: "#FF3DA5",
    textPrimary: "#F0D8E4",
    textSecondary: "#A87898",
    textMuted: "#604050",
  },
  {
    id: "orman",
    name: "Orman",
    colors: ["#9BC264", "#1a2010", "#6B8F3C", "#C8E6A0"],
    bgPrimary: "#1a2010",
    bgDark: "#14190c",
    bgDarker: "#0f1208",
    accent: "#9BC264",
    accentHover: "#AFCF7E",
    textPrimary: "#E0E8D0",
    textSecondary: "#88986A",
    textMuted: "#4A5535",
  },
  {
    id: "lavanta",
    name: "Lavanta",
    colors: ["#E491C9", "#15173D", "#C774AE", "#F0B8DC"],
    bgPrimary: "#15173D",
    bgDark: "#101232",
    bgDarker: "#0b0d27",
    accent: "#E491C9",
    accentHover: "#EAA8D5",
    textPrimary: "#E8DDF0",
    textSecondary: "#9888A8",
    textMuted: "#554868",
  },
  {
    id: "bakir",
    name: "Bakir",
    colors: ["#DCA06D", "#210F37", "#B8804D", "#F0C8A0"],
    bgPrimary: "#210F37",
    bgDark: "#1a0c2c",
    bgDarker: "#130821",
    accent: "#DCA06D",
    accentHover: "#E5B58A",
    textPrimary: "#E8DDD4",
    textSecondary: "#A09080",
    textMuted: "#584838",
  },
  {
    id: "cyan",
    name: "Cyan",
    colors: ["#00F7FF", "#0a1520", "#00C4CC", "#80FBFF"],
    bgPrimary: "#0a1520",
    bgDark: "#071018",
    bgDarker: "#050c12",
    accent: "#00F7FF",
    accentHover: "#40F9FF",
    textPrimary: "#D8F0F0",
    textSecondary: "#70A8A8",
    textMuted: "#385858",
  },
  {
    id: "gunes",
    name: "Gunes",
    colors: ["#FFC400", "#1a1508", "#CC9E00", "#FFD84D"],
    bgPrimary: "#1a1508",
    bgDark: "#141005",
    bgDarker: "#0e0c03",
    accent: "#FFC400",
    accentHover: "#FFD040",
    textPrimary: "#F0E8D0",
    textSecondary: "#A89860",
    textMuted: "#585030",
  },
  {
    id: "deniz",
    name: "Deniz",
    colors: ["#088395", "#091e22", "#05B2C6", "#8CE0EB"],
    bgPrimary: "#091e22",
    bgDark: "#06171a",
    bgDarker: "#041012",
    accent: "#088395",
    accentHover: "#0A9AAE",
    textPrimary: "#D0E8EC",
    textSecondary: "#688E94",
    textMuted: "#354A4E",
  },
  {
    id: "retro",
    name: "Retro",
    colors: ["#FA8112", "#222222", "#CC6A0F", "#FFAA55"],
    bgPrimary: "#222222",
    bgDark: "#1a1a1a",
    bgDarker: "#131313",
    accent: "#FA8112",
    accentHover: "#FF9A40",
    textPrimary: "#E8E0D8",
    textSecondary: "#A09080",
    textMuted: "#585048",
  },
  {
    id: "buz",
    name: "Buz",
    colors: ["#9CCFFF", "#1a1f30", "#6AAFEF", "#C8E4FF"],
    bgPrimary: "#1a1f30",
    bgDark: "#141928",
    bgDarker: "#0e1320",
    accent: "#9CCFFF",
    accentHover: "#B4DCFF",
    textPrimary: "#E0E8F4",
    textSecondary: "#8098B0",
    textMuted: "#405060",
  },
];

// ── Overlay Stil Tanimlari ──

export interface OptionDef<T extends string> {
  id: T;
  name: string;
  desc: string;
}

export const OVERLAY_STYLES: OptionDef<OverlayStyle>[] = [
  { id: "default", name: "Varsayilan", desc: "Sicak isikli centik" },
  { id: "pill", name: "Hap", desc: "Yuvarlak kapsul" },
  { id: "neon", name: "Neon", desc: "Parlak neon isik" },
  { id: "minimal", name: "Minimal", desc: "Ultra ince cizgi" },
  { id: "glass", name: "Cam", desc: "Glassmorphism blur" },
  { id: "wave", name: "Dalga", desc: "Genis dalga formu" },
  { id: "frost", name: "Buzul", desc: "Soguk bulaniklastirma" },
  { id: "ember", name: "Kor", desc: "Sicak kor parlama" },
  { id: "sharp", name: "Keskin", desc: "Sivri kose tasarim" },
  { id: "float", name: "Suzen", desc: "Havada suzen efekt" },
];

export const OVERLAY_ANIMATIONS: OptionDef<OverlayAnimation>[] = [
  { id: "smooth", name: "Yumusak", desc: "Akici gecis" },
  { id: "bounce", name: "Ziplama", desc: "Zipli yay efekti" },
  { id: "slide", name: "Kayma", desc: "Asagidan yukari kayar" },
  { id: "scale", name: "Buyume", desc: "Merkezden buyur" },
  { id: "elastic", name: "Elastik", desc: "Lastik bant efekti" },
  { id: "snap", name: "Ani", desc: "Aninda acilir" },
  { id: "drop", name: "Dusme", desc: "Yukdan asagi duser" },
  { id: "twist", name: "Burulma", desc: "Donerek acilir" },
  { id: "fade", name: "Belirme", desc: "Yavas belirir" },
  { id: "ripple", name: "Dalga", desc: "Dalga etkisiyle acilir" },
];

export const WAVEFORM_STYLES: OptionDef<WaveformStyle>[] = [
  { id: "classic", name: "Klasik", desc: "Cok katmanli dalga" },
  { id: "thin", name: "Ince", desc: "Tek ince cizgi" },
  { id: "thick", name: "Kalin", desc: "Kalin parlak cizgi" },
  { id: "pulse", name: "Nabiz", desc: "Kalp atisi seklinde" },
  { id: "mirror", name: "Ayna", desc: "Ust-alt simetrik" },
  { id: "bars", name: "Cubuklar", desc: "Dikey cubuk ekolayzir" },
  { id: "dot", name: "Noktalar", desc: "Ziplayan daireler" },
  { id: "helix", name: "Sarmal", desc: "Cift helis DNA stili" },
  { id: "spectrum", name: "Spektrum", desc: "Dolgulu dalga alani" },
  { id: "scatter", name: "Serpinti", desc: "Dagilan parcaciklar" },
  { id: "zigzag", name: "Zigzag", desc: "Keskin acili cizgiler" },
  { id: "orbit", name: "Yorunge", desc: "Donen dairesel hareket" },
];

export const GLOW_INTENSITIES: OptionDef<GlowIntensity>[] = [
  { id: "none", name: "Yok", desc: "Parlama efekti yok" },
  { id: "subtle", name: "Hafif", desc: "Belli belirsiz isik" },
  { id: "medium", name: "Orta", desc: "Dengeli parlama" },
  { id: "intense", name: "Yogun", desc: "Guclu neon parlama" },
];

export const SOUND_PACKS: OptionDef<SoundPack>[] = [
  { id: "varsayilan", name: "Varsayilan", desc: "Sicak ve tok ping sesi" },
  { id: "kristal", name: "Kristal", desc: "Yuksek tonlu cam tini" },
  { id: "mekanik", name: "Mekanik", desc: "Dijital kare dalga bip" },
  { id: "yumusak", name: "Yumusak", desc: "Derin ve sakin ton" },
  { id: "bip", name: "Bip", desc: "Kisa klasik bip sesi" },
  { id: "tok", name: "Tok", desc: "Derin ve guclu vurus" },
  { id: "pop", name: "Pop", desc: "Balon patlama efekti" },
  { id: "zil", name: "Zil", desc: "Ince metalik zil sesi" },
  { id: "dalga", name: "Dalga", desc: "Yukselen dalga efekti" },
  { id: "sessiz", name: "Sessiz", desc: "Ses efekti kapatilir" },
];

export function getPaletteById(id: string): ThemePalette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}
