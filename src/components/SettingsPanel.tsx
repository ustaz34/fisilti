import React, { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { useSettingsStore, type AppSettings, type WakeWordStatus } from "../stores/settingsStore";
import {
  listAudioDevices,
  saveSettings,
  changeShortcut,
  setOverlayFollowCursor,
  type AudioDevice,
} from "../lib/tauri-commands";

/* ════════════════════════════════════════
   Helpers — untouched business logic
   ════════════════════════════════════════ */

const LANGUAGES = [
  { id: "tr", name: "Turkce" },
  { id: "en", name: "English" },
  { id: "de", name: "Deutsch" },
  { id: "fr", name: "Francais" },
  { id: "es", name: "Espanol" },
  { id: "it", name: "Italiano" },
  { id: "pt", name: "Portugues" },
  { id: "ru", name: "Rusca" },
  { id: "ja", name: "Japonca" },
  { id: "zh", name: "Cince" },
];

function toBackend(s: AppSettings) {
  return {
    selected_model: s.selectedModel, selected_device: s.selectedDevice,
    theme: s.theme, shortcut: s.shortcut, recording_mode: s.recordingMode,
    vad_threshold: s.vadThreshold, auto_paste: s.autoPaste,
    language: s.language, transcription_engine: s.transcriptionEngine,
    voice_activation: s.voiceActivation, wake_word: s.wakeWord,
    sound_enabled: s.soundEnabled, auto_start: s.autoStart,
    silence_timeout: s.silenceTimeout, max_record_duration: s.maxRecordDuration,
    turkish_corrections: s.turkishCorrections, hallucination_filter: s.hallucinationFilter,
    overlay_follow_cursor: s.overlayFollowCursor,
    auto_punctuation: s.autoPunctuation, auto_capitalization: s.autoCapitalization,
    preserve_english_words: s.preserveEnglishWords, auto_comma: s.autoComma,
    paragraph_break: s.paragraphBreak,
    notifications: s.notifications, log_level: s.logLevel,
  };
}

/* ════════════════════════════════════════
   Section Icons
   ════════════════════════════════════════ */

const icons = {
  engine: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  language: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  record: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.3" />
    </svg>
  ),
  voice: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  text: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  ),
  system: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  optimize: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
};

/* ════════════════════════════════════════
   Micro-components — redesigned
   ════════════════════════════════════════ */

function Section({
  title, icon, children, accent,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode; accent?: boolean;
}) {
  return (
    <div className="sp-section">
      <div className="sp-section-head">
        <div className={`sp-section-icon ${accent ? "sp-section-icon--accent" : ""}`}>{icon}</div>
        <h2 className="sp-section-title">{title}</h2>
        <div className="sp-section-line" />
      </div>
      <div className={`sp-section-body ${accent ? "sp-section-body--accent" : ""}`}>
        {children}
      </div>
    </div>
  );
}

function Pill({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className="sp-toggle"
      data-on={checked || undefined}
      aria-pressed={checked}
    >
      <div className="sp-toggle-track">
        <div className="sp-toggle-thumb" />
        {checked && <div className="sp-toggle-glow" />}
      </div>
    </button>
  );
}

function Item({
  title, desc, onClick, children, compact,
}: {
  title: string; desc?: string; onClick?: () => void; children?: React.ReactNode; compact?: boolean;
}) {
  return (
    <div onClick={onClick}
      className={`sp-item ${onClick ? "sp-item--click" : ""} ${compact ? "sp-item--compact" : ""}`}
    >
      <div className="sp-item-text">
        <span className="sp-item-title">{title}</span>
        {desc && <span className="sp-item-desc">{desc}</span>}
      </div>
      {children && <div className="sp-item-ctrl">{children}</div>}
    </div>
  );
}

function Sel({ value, options, onChange }: {
  value: string; options: { id: string; name: string }[]; onChange: (v: string) => void;
}) {
  return (
    <div className="sp-select-wrap">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="sp-select">
        {options.map((o) => (
          <option key={o.id} value={o.id} className="bg-[var(--color-bg-dark)] text-[var(--color-accent)]">{o.name}</option>
        ))}
      </select>
      <svg className="sp-select-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>
    </div>
  );
}

function Range({ label, value, min, max, step, unit, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="sp-range">
      <div className="sp-range-header">
        <span className="sp-range-label">{label}</span>
        <span className="sp-range-value">{fmt ? fmt(value) : `${value}${unit}`}</span>
      </div>
      <div className="sp-range-track-wrap">
        <div className="sp-range-track">
          <div className="sp-range-fill" style={{ width: `${pct}%` }} />
        </div>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="sp-range-input" />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Voice Status Indicator
   ════════════════════════════════════════ */

const STATUS_MAP: Record<WakeWordStatus, { label: string; color: string; pulse?: boolean }> = {
  inactive:       { label: "Kapali",              color: "rgba(255,255,255,0.15)" },
  requesting_mic: { label: "Mikrofon isteniyor",  color: "#f5c842", pulse: true },
  starting:       { label: "Baslatiliyor...",     color: "#f5c842", pulse: true },
  listening:      { label: "Dinliyor",            color: "#4ade80", pulse: true },
  hearing:        { label: "Duyulan: ...",        color: "#4ade80", pulse: true },
  error:          { label: "Hata",                color: "#f87171" },
  detected:       { label: "Algilandi!",          color: "#fae4cf", pulse: true },
  no_support:     { label: "Desteklenmiyor",      color: "#f87171" },
};

function VoiceStatus() {
  const status = useSettingsStore((s) => s.wakeWordStatus);
  const errorMsg = useSettingsStore((s) => s.wakeWordError);
  const info = STATUS_MAP[status];

  return (
    <div className="sp-voice-status">
      <div className="sp-voice-dot-wrap">
        <div className={`sp-voice-dot ${info.pulse ? "sp-pulse" : ""}`}
          style={{ background: info.color, boxShadow: info.pulse ? `0 0 8px ${info.color}` : "none" }} />
      </div>
      <div className="sp-voice-label">
        <span className="sp-voice-label-text" style={{ color: info.color }}>
          {status === "hearing" && errorMsg ? `Duyulan: ${errorMsg}` : info.label}
        </span>
        {errorMsg && status === "error" && <span className="sp-voice-err">{errorMsg}</span>}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Engine Card — with icon + glow
   ════════════════════════════════════════ */

function EngineCard({ active, title, desc, icon, onClick }: {
  active: boolean; title: string; desc: string; icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className={`sp-engine ${active ? "sp-engine--on" : ""}`}>
      {active && <div className="sp-engine-glow" />}
      <div className="sp-engine-icon">{icon}</div>
      <div className="sp-engine-title">{title}</div>
      <div className="sp-engine-desc">{desc}</div>
      {active && (
        <div className="sp-engine-badge">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
      )}
    </button>
  );
}

/* ════════════════════════════════════════
   Shortcut Chip — redesigned
   ════════════════════════════════════════ */

function ShortcutChip({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [rec, setRec] = useState(false);

  const onKey = (e: React.KeyboardEvent) => {
    if (!rec) return;
    e.preventDefault();
    if (e.key === "Escape") { setRec(false); return; }
    const mods = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (["Control","Shift","Alt"].includes(e.key)) return;
    let key = e.key.toUpperCase().replace("ARROW","");
    if (key === " ") key = "Space";
    onChange([...mods, key].join("+"));
    setRec(false);
  };

  if (rec) {
    return (
      <button onKeyDown={onKey} onBlur={() => setRec(false)} autoFocus className="sp-shortcut sp-shortcut--rec">
        <span className="sp-shortcut-pulse" />
        Tusa basin...
      </button>
    );
  }

  return (
    <button onClick={() => setRec(true)} className="sp-shortcut">
      {value.split("+").map((k, i) => (
        <kbd key={i} className="sp-kbd">{k}</kbd>
      ))}
    </button>
  );
}

/* ════════════════════════════════════════
   Main Panel
   ════════════════════════════════════════ */

export function SettingsPanel() {
  const { settings, updateSettings } = useSettingsStore();
  const [devices, setDevices] = useState<AudioDevice[]>([]);

  useEffect(() => { listAudioDevices().then(setDevices).catch(console.error); }, []);

  const save = (partial: Partial<AppSettings>) => {
    updateSettings(partial);
    setTimeout(async () => {
      const cur = useSettingsStore.getState().settings;
      try { await saveSettings(toBackend(cur)); await emit("settings-changed", cur); }
      catch (e) { console.error("Save error:", e); }
    }, 0);
  };

  const isWeb = settings.transcriptionEngine === "web";

  return (
    <div className="sp-root">

      {/* ── Motor ── */}
      <Section title="Motor" icon={icons.engine}>
        <div className="sp-engine-grid">
          <EngineCard active={isWeb} title="Google" desc="Online · Hizli"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>}
            onClick={() => save({ transcriptionEngine: "web" })} />
          <EngineCard active={!isWeb} title="Whisper" desc="Offline · Yerel"
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /></svg>}
            onClick={() => save({ transcriptionEngine: "whisper" })} />
        </div>
      </Section>

      {/* ── Dil ve Giris ── */}
      <Section title="Dil ve Giris" icon={icons.language}>
        <Item title="Tanima dili">
          <Sel value={settings.language} options={LANGUAGES} onChange={(v) => save({ language: v })} />
        </Item>
        <Item title="Mikrofon">
          <Sel value={settings.selectedDevice || ""} options={[{ id: "", name: "Varsayilan" }, ...devices]} onChange={(v) => save({ selectedDevice: v || null })} />
        </Item>
        <Range label="Sessizlik zamani" value={settings.silenceTimeout} min={2} max={10} step={0.5} unit="sn" onChange={(v) => save({ silenceTimeout: v })} />
        <Range label="Ses algilama esigi (VAD)" value={Math.round(settings.vadThreshold * 100)} min={10} max={90} step={5} unit="%"
          onChange={(v) => save({ vadThreshold: v / 100 })} />
      </Section>

      {/* ── Kayit ── */}
      <Section title="Kayit" icon={icons.record}>
        <Item title="Kisayol tusu" desc="Basili tut → kaydet, birak → durdur">
          <ShortcutChip value={settings.shortcut}
            onChange={async (s) => { try { await changeShortcut(s); save({ shortcut: s }); } catch {} }} />
        </Item>
        <Item title="Sinirsiz kayit" desc="Sure limiti olmadan" onClick={() => save({ maxRecordDuration: settings.maxRecordDuration === 0 ? 60 : 0 })}>
          <Pill checked={settings.maxRecordDuration === 0} onChange={() => save({ maxRecordDuration: settings.maxRecordDuration === 0 ? 60 : 0 })} />
        </Item>
        {settings.maxRecordDuration !== 0 && (
          <Range label="Maks. sure" value={settings.maxRecordDuration} min={10} max={600} step={10} unit="sn"
            fmt={(v) => { const m = Math.floor(v/60), s = v%60; return m > 0 ? `${m}dk${s > 0 ? ` ${s}sn` : ""}` : `${s}sn`; }}
            onChange={(v) => save({ maxRecordDuration: v })} />
        )}
      </Section>

      {/* ── Sesli Aktivasyon ── */}
      <Section title="Sesli Aktivasyon" icon={icons.voice} accent>
        <Item title="Sesle baslatma" desc={`"${settings.wakeWord}" diyerek baslatir`} onClick={() => save({ voiceActivation: !settings.voiceActivation })}>
          <Pill checked={settings.voiceActivation} onChange={() => save({ voiceActivation: !settings.voiceActivation })} />
        </Item>
        {settings.voiceActivation && (
          <>
            <div className="sp-item sp-item--compact">
              <VoiceStatus />
            </div>
            <Item title="Uyanma kelimesi">
              <input type="text" value={settings.wakeWord} onChange={(e) => save({ wakeWord: e.target.value })} placeholder="fisilti" className="sp-text-input" />
            </Item>
          </>
        )}
      </Section>

      {/* ── Metin Isleme ── */}
      <Section title="Metin Isleme" icon={icons.text}>
        {/* Temel */}
        <div className="sp-subgroup-label">Temel</div>
        <Item title="Otomatik yapistir" desc="Sonucu aktif uygulamaya otomatik gonder" onClick={() => save({ autoPaste: !settings.autoPaste })}>
          <Pill checked={settings.autoPaste} onChange={() => save({ autoPaste: !settings.autoPaste })} />
        </Item>
        <Item title="Halusinasyon filtresi" desc="Whisper'in urettigi sahte/tekrarli metinleri engelle" onClick={() => save({ hallucinationFilter: !settings.hallucinationFilter })}>
          <Pill checked={settings.hallucinationFilter} onChange={() => save({ hallucinationFilter: !settings.hallucinationFilter })} />
        </Item>

        {/* Noktalama & Yazim */}
        <div className="sp-subgroup-label">Noktalama & Yazim</div>
        <Item title="Otomatik noktalama" desc="Cumle sonuna otomatik nokta, soru veya unlem isareti ekle" onClick={() => save({ autoPunctuation: !settings.autoPunctuation })}>
          <Pill checked={settings.autoPunctuation} onChange={() => save({ autoPunctuation: !settings.autoPunctuation })} />
        </Item>
        <Item title="Buyuk harf duzeltme" desc="Cumle baslarini buyuk harfle baslat (Turkce I destegi)" onClick={() => save({ autoCapitalization: !settings.autoCapitalization })}>
          <Pill checked={settings.autoCapitalization} onChange={() => save({ autoCapitalization: !settings.autoCapitalization })} />
        </Item>
        <Item title="Otomatik virgul" desc="Baglaclar oncesine virgul ekle (ama, cunku, ancak...)" onClick={() => save({ autoComma: !settings.autoComma })}>
          <Pill checked={settings.autoComma} onChange={() => save({ autoComma: !settings.autoComma })} />
        </Item>
        <Item title="Paragraf modu" desc="Cumleler arasi satir sonu ekle" onClick={() => save({ paragraphBreak: !settings.paragraphBreak })}>
          <Pill checked={settings.paragraphBreak} onChange={() => save({ paragraphBreak: !settings.paragraphBreak })} />
        </Item>

        {/* Turkce Ozel */}
        <div className="sp-subgroup-label">Turkce Ozel</div>
        <Item title="Turkce duzeltmeler" desc="Eksik Turkce karakterleri duzelt (cok→cok, guzel→guzel)" onClick={() => save({ turkishCorrections: !settings.turkishCorrections })}>
          <Pill checked={settings.turkishCorrections} onChange={() => save({ turkishCorrections: !settings.turkishCorrections })} />
        </Item>
        <Item title="Ingilizce kelime koruma" desc="Meeting, project gibi Ingilizce kelimelere dokunma" onClick={() => save({ preserveEnglishWords: !settings.preserveEnglishWords })}>
          <Pill checked={settings.preserveEnglishWords} onChange={() => save({ preserveEnglishWords: !settings.preserveEnglishWords })} />
        </Item>
      </Section>

      {/* ── Sistem ── */}
      <Section title="Sistem" icon={icons.system}>
        <Item title="Ses efektleri" desc="Baslangic / bitis sesleri" onClick={() => save({ soundEnabled: !settings.soundEnabled })}>
          <Pill checked={settings.soundEnabled} onChange={() => save({ soundEnabled: !settings.soundEnabled })} />
        </Item>
        <Item title="Otomatik baslat" desc="Windows ile birlikte ac" onClick={() => save({ autoStart: !settings.autoStart })}>
          <Pill checked={settings.autoStart} onChange={() => save({ autoStart: !settings.autoStart })} />
        </Item>
        <Item title="Overlay takibi" desc="Fare imlecinin monitorune tasin" onClick={() => {
          save({ overlayFollowCursor: !settings.overlayFollowCursor });
          setOverlayFollowCursor(!settings.overlayFollowCursor).catch(console.error);
        }}>
          <Pill checked={settings.overlayFollowCursor} onChange={() => {
            save({ overlayFollowCursor: !settings.overlayFollowCursor });
            setOverlayFollowCursor(!settings.overlayFollowCursor).catch(console.error);
          }} />
        </Item>
        <Item title="Bildirimler" desc="Donusum tamamlandiginda bildirim goster" onClick={() => save({ notifications: !settings.notifications })}>
          <Pill checked={settings.notifications} onChange={() => save({ notifications: !settings.notifications })} />
        </Item>
        <Item title="Log seviyesi" desc="Uygulama log detay seviyesi">
          <Sel value={settings.logLevel} options={[
            { id: "error", name: "Hata" },
            { id: "warn", name: "Uyari" },
            { id: "info", name: "Bilgi" },
            { id: "debug", name: "Debug" },
          ]} onChange={(v) => save({ logLevel: v })} />
        </Item>
      </Section>

    </div>
  );
}
