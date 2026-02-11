/**
 * Ses Efektleri - Web Audio API ile programatik ses sentezi.
 * Dosya gerektirmez, tamamen kod ile uretilir.
 * Ses paketi secimi ThemeConfig uzerinden yapilir.
 *
 * Aktivasyon: Tek yukselen ton (yukari slide)
 * Deaktivasyon: Iki ardisik inen nota (cift "du-dum" asagi)
 * Hata: Kisa titresimli uyari
 */

import { useSettingsStore } from "../stores/settingsStore";
import { loadThemeConfig } from "./themeEngine";
import type { SoundPack } from "./themes";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function getCurrentSoundPack(): SoundPack {
  try {
    return loadThemeConfig().soundPack || "varsayilan";
  } catch {
    return "varsayilan";
  }
}

interface SoundDef {
  type: OscillatorType;
  freqStart: number;
  freqEnd: number;
  gain: number;
  duration: number;
}

interface DeactivationDef {
  note1: SoundDef;
  note2: SoundDef;
  delay: number;
}

// ── Aktivasyon: Tek yukselen ton ──

const ACTIVATION_SOUNDS: Record<SoundPack, SoundDef | null> = {
  varsayilan: { type: "sine",     freqStart: 880,  freqEnd: 1100, gain: 0.15, duration: 0.12 },
  kristal:    { type: "triangle", freqStart: 1400, freqEnd: 1800, gain: 0.10, duration: 0.10 },
  mekanik:    { type: "square",   freqStart: 600,  freqEnd: 800,  gain: 0.08, duration: 0.08 },
  yumusak:    { type: "sine",     freqStart: 440,  freqEnd: 580,  gain: 0.12, duration: 0.18 },
  bip:        { type: "sine",     freqStart: 1000, freqEnd: 1000, gain: 0.13, duration: 0.06 },
  tok:        { type: "sine",     freqStart: 120,  freqEnd: 200,  gain: 0.20, duration: 0.08 },
  pop:        { type: "sine",     freqStart: 600,  freqEnd: 1400, gain: 0.14, duration: 0.05 },
  zil:        { type: "triangle", freqStart: 2000, freqEnd: 2400, gain: 0.07, duration: 0.15 },
  dalga:      { type: "sine",     freqStart: 300,  freqEnd: 900,  gain: 0.12, duration: 0.25 },
  sessiz:     null,
};

// ── Deaktivasyon: Cift inen nota (du-dum) ──

const DEACTIVATION_SOUNDS: Record<SoundPack, DeactivationDef | null> = {
  varsayilan: {
    note1: { type: "triangle", freqStart: 660, freqEnd: 580, gain: 0.12, duration: 0.08 },
    note2: { type: "triangle", freqStart: 440, freqEnd: 340, gain: 0.10, duration: 0.12 },
    delay: 0.09,
  },
  kristal: {
    note1: { type: "sine",    freqStart: 1600, freqEnd: 1300, gain: 0.08, duration: 0.07 },
    note2: { type: "sine",    freqStart: 1000, freqEnd: 700,  gain: 0.06, duration: 0.10 },
    delay: 0.08,
  },
  mekanik: {
    note1: { type: "square",  freqStart: 700,  freqEnd: 500,  gain: 0.06, duration: 0.05 },
    note2: { type: "square",  freqStart: 400,  freqEnd: 250,  gain: 0.05, duration: 0.07 },
    delay: 0.06,
  },
  yumusak: {
    note1: { type: "sine",    freqStart: 500,  freqEnd: 420,  gain: 0.10, duration: 0.12 },
    note2: { type: "sine",    freqStart: 320,  freqEnd: 220,  gain: 0.08, duration: 0.16 },
    delay: 0.13,
  },
  bip: {
    note1: { type: "sine",    freqStart: 900,  freqEnd: 900,  gain: 0.10, duration: 0.04 },
    note2: { type: "sine",    freqStart: 600,  freqEnd: 600,  gain: 0.08, duration: 0.04 },
    delay: 0.05,
  },
  tok: {
    note1: { type: "sine",    freqStart: 160,  freqEnd: 120,  gain: 0.18, duration: 0.06 },
    note2: { type: "sine",    freqStart: 90,   freqEnd: 55,   gain: 0.16, duration: 0.10 },
    delay: 0.07,
  },
  pop: {
    note1: { type: "triangle", freqStart: 1200, freqEnd: 800,  gain: 0.11, duration: 0.04 },
    note2: { type: "triangle", freqStart: 600,  freqEnd: 350,  gain: 0.09, duration: 0.05 },
    delay: 0.05,
  },
  zil: {
    note1: { type: "sine",    freqStart: 2200, freqEnd: 1800, gain: 0.05, duration: 0.10 },
    note2: { type: "sine",    freqStart: 1400, freqEnd: 1000, gain: 0.04, duration: 0.14 },
    delay: 0.11,
  },
  dalga: {
    note1: { type: "sine",    freqStart: 800,  freqEnd: 500,  gain: 0.10, duration: 0.15 },
    note2: { type: "sine",    freqStart: 400,  freqEnd: 150,  gain: 0.08, duration: 0.22 },
    delay: 0.16,
  },
  sessiz: null,
};

// ── Hata / Bos kapanma: Tuplu TV kapanma sesi ──
// Yuksek frekanstan asagi hizla inen "pwiiiuuu" + viziltili harmonik

function playSound(def: SoundDef | null): void {
  if (!def) return;
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = def.type;
    osc.frequency.setValueAtTime(def.freqStart, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(def.freqEnd, ctx.currentTime + def.duration);

    gain.gain.setValueAtTime(def.gain, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + def.duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + def.duration);
  } catch {
    // Ses calamazsa sessizce devam et
  }
}

function playDoubleSound(def: DeactivationDef | null): void {
  if (!def) return;
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Birinci nota
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = def.note1.type;
    osc1.frequency.setValueAtTime(def.note1.freqStart, now);
    osc1.frequency.linearRampToValueAtTime(def.note1.freqEnd, now + def.note1.duration);
    gain1.gain.setValueAtTime(def.note1.gain, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + def.note1.duration);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + def.note1.duration);

    // Ikinci nota (delay sonra)
    const t2 = now + def.delay;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = def.note2.type;
    osc2.frequency.setValueAtTime(def.note2.freqStart, t2);
    osc2.frequency.linearRampToValueAtTime(def.note2.freqEnd, t2 + def.note2.duration);
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(def.note2.gain, t2);
    gain2.gain.exponentialRampToValueAtTime(0.001, t2 + def.note2.duration);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t2);
    osc2.stop(t2 + def.note2.duration);
  } catch {
    // Ses calamazsa sessizce devam et
  }
}

/**
 * Tuplu TV kapanma sesi — "pwiiiuuu"
 * Iki katmanli: ana sweep (sine yukseltan asagi) + viziltili harmonik (sawtooth)
 */
function playCRTShutdown(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const dur = 0.32;

    // Ana sweep: 2800Hz -> 55Hz hizla asagi
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(2800, now);
    osc1.frequency.exponentialRampToValueAtTime(55, now + dur);
    gain1.gain.setValueAtTime(0.13, now);
    gain1.gain.setValueAtTime(0.10, now + dur * 0.3);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + dur);

    // Viziltili harmonik: sawtooth 1400Hz -> 30Hz (yarım oktav alt, daha kirli)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(1400, now);
    osc2.frequency.exponentialRampToValueAtTime(30, now + dur);
    gain2.gain.setValueAtTime(0.04, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.8);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now);
    osc2.stop(now + dur);
  } catch {
    // Ses calamazsa sessizce devam et
  }
}

/** Aktivasyon sesi — tek yukselen ton */
export function playActivationSound(): void {
  if (!useSettingsStore.getState().settings.soundEnabled) return;
  const pack = getCurrentSoundPack();
  playSound(ACTIVATION_SOUNDS[pack]);
}

/** Deaktivasyon sesi — cift inen nota */
export function playDeactivationSound(): void {
  if (!useSettingsStore.getState().settings.soundEnabled) return;
  const pack = getCurrentSoundPack();
  playDoubleSound(DEACTIVATION_SOUNDS[pack]);
}

/** Hata / bos kapanma sesi — tuplu TV kapanma "pwiiiuuu" */
export function playErrorSound(): void {
  if (!useSettingsStore.getState().settings.soundEnabled) return;
  if (getCurrentSoundPack() === "sessiz") return;
  playCRTShutdown();
}

/** Onizleme: Secilen paketin aktivasyon sesini cal */
export function previewActivationSound(pack: SoundPack): void {
  playSound(ACTIVATION_SOUNDS[pack]);
}

/** Onizleme: Secilen paketin deaktivasyon sesini cal */
export function previewDeactivationSound(pack: SoundPack): void {
  playDoubleSound(DEACTIVATION_SOUNDS[pack]);
}
