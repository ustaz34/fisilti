import React, { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { useTTSStore, loadTTSSettings, saveTTSSettings, type TTSEngine, type TTSLanguage, TTS_LANGUAGES } from "../stores/ttsStore";
import { useSettingsStore, type AppSettings } from "../stores/settingsStore";
import { getTTSService } from "../lib/ttsService";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { changeShortcut as changeTtsShortcutCmd } from "../lib/tauri-commands";
import { invoke } from "@tauri-apps/api/core";

/* ════════════════════════════════════════
   Micro-components (SettingsPanel paterni)
   ════════════════════════════════════════ */

function Section({
  title, icon, children,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="sp-section">
      <div className="sp-section-head">
        <div className="sp-section-icon">{icon}</div>
        <h2 className="sp-section-title">{title}</h2>
        <div className="sp-section-line" />
      </div>
      <div className="sp-section-body">
        {children}
      </div>
    </div>
  );
}

function Item({
  title, desc, children, compact,
}: {
  title: string; desc?: string; children?: React.ReactNode; compact?: boolean;
}) {
  return (
    <div className={`sp-item ${compact ? "sp-item--compact" : ""}`}>
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

function RangeSlider({ label, value, min, max, step, unit, onChange, fmt }: {
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
   Icons
   ════════════════════════════════════════ */

const icons = {
  text: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  ),
  speaker: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  ),
  shortcut: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h12" />
    </svg>
  ),
};

/* ════════════════════════════════════════
   TTS Panel
   ════════════════════════════════════════ */

export function TTSPanel() {
  const {
    status, charIndex, totalChars,
    settings: ttsSettings,
    voices,
    edgeVoices,
  } = useTTSStore();
  const { settings: appSettings, updateSettings } = useSettingsStore();
  const [text, setText] = useState("");
  const [editingShortcut, setEditingShortcut] = useState(false);
  const [shortcutInput, setShortcutInput] = useState("");
  const [shortcutError, setShortcutError] = useState("");

  // TTS ayarlarini yukle
  useEffect(() => {
    loadTTSSettings();
    getTTSService();
  }, []);

  const progress = totalChars > 0 ? (charIndex / totalChars) * 100 : 0;
  const isEdge = ttsSettings.engine === "edge";
  const currentLang = ttsSettings.language || "tr";

  // Dile gore locale prefix'leri (Edge: "tr-", "ar-", "en-", "ru-")
  const langLocaleMap: Record<string, string[]> = {
    tr: ["tr-", "TR"],
    en: ["en-", "EN"],
    ar: ["ar-", "AR"],
    ru: ["ru-", "RU"],
  };

  // Ses seceneklerini motora ve dile gore olustur
  const buildVoiceOptions = (lang: string, engine: string) => {
    const prefixes = langLocaleMap[lang] || [lang + "-"];
    let opts: { id: string; name: string }[] = [];

    if (engine === "edge") {
      const langVoices = edgeVoices.filter((v) =>
        prefixes.some((p) => v.Locale.startsWith(p))
      );
      opts = langVoices.map((v) => ({
        id: v.ShortName,
        name: `${v.FriendlyName || v.ShortName} (${v.Gender === "Female" ? "Kadın" : "Erkek"})`,
      }));
    } else {
      const langVoices = voices.filter((v) =>
        prefixes.some((p) => v.lang.startsWith(p))
      );
      opts = langVoices.map((v) => ({
        id: v.voiceURI,
        name: `${v.name} (${v.lang})`,
      }));
    }
    return opts;
  };

  const voiceOptions = buildVoiceOptions(currentLang, ttsSettings.engine);

  // Motor degisimi — sesi sifirla, dile gore yeni varsayilan sec
  const handleEngineChange = (engine: string) => {
    const e = engine as TTSEngine;
    const newOpts = buildVoiceOptions(currentLang, e);
    const defaultVoice = newOpts.length > 0 ? newOpts[0].id : "";
    useTTSStore.getState().updateTTSSettings({ engine: e, selectedVoice: defaultVoice });
    saveTTSSettings();
  };

  // Dil degisimi — sesi sifirla, yeni dile gore varsayilan sec
  const handleLanguageChange = (lang: string) => {
    const l = lang as TTSLanguage;
    const newOpts = buildVoiceOptions(l, ttsSettings.engine);
    const defaultVoice = newOpts.length > 0 ? newOpts[0].id : "";
    useTTSStore.getState().updateTTSSettings({ language: l, selectedVoice: defaultVoice });
    saveTTSSettings();
  };

  const handlePlay = () => {
    if (status === "paused") {
      getTTSService().resume();
    } else if (status === "speaking") {
      getTTSService().pause();
    } else {
      if (!text.trim()) return;
      getTTSService().speak(text);
    }
  };

  const handleStop = () => {
    getTTSService().stop();
  };

  const handlePaste = async () => {
    try {
      const clipText = await readText();
      if (clipText) setText(clipText);
    } catch (e) {
      console.error("Pano okunamadi:", e);
    }
  };

  const handleTestVoice = () => {
    const langInfo = TTS_LANGUAGES.find((l) => l.id === currentLang);
    getTTSService().speak(langInfo?.testText || "Merhaba, bu bir ses testidir.");
  };

  const handleVoiceChange = (voiceId: string) => {
    useTTSStore.getState().updateTTSSettings({ selectedVoice: voiceId });
    saveTTSSettings();
  };

  const handleRateChange = (rate: number) => {
    useTTSStore.getState().updateTTSSettings({ rate });
    saveTTSSettings();
  };

  const handlePitchChange = (pitch: number) => {
    useTTSStore.getState().updateTTSSettings({ pitch });
    saveTTSSettings();
  };

  const handleVolumeChange = (volume: number) => {
    useTTSStore.getState().updateTTSSettings({ volume });
    saveTTSSettings();
  };

  // Varsayilan ses secimi (ilk yukleme)
  if (voiceOptions.length > 0 && !ttsSettings.selectedVoice) {
    const defaultVoice = voiceOptions[0].id;
    handleVoiceChange(defaultVoice);
  }

  // Kisayol degistirme — Tauri formatina uygun tus isimlerini uretir
  const handleShortcutKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShortcutError("");

    const key = e.key;
    if (key === "Escape") { setEditingShortcut(false); setShortcutError(""); return; }
    if (["Control", "Shift", "Alt", "Meta"].includes(key)) return;

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");

    const keyMap: Record<string, string> = {
      " ": "Space", ArrowUp: "Up", ArrowDown: "Down",
      ArrowLeft: "Left", ArrowRight: "Right",
      Escape: "Escape", Enter: "Enter", Tab: "Tab",
      Backspace: "Backspace", Delete: "Delete",
      Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
      Insert: "Insert", CapsLock: "CapsLock", NumLock: "NumLock",
      ScrollLock: "ScrollLock", Pause: "Pause", PrintScreen: "PrintScreen",
    };

    let keyName = keyMap[key] || key;
    if (keyName.length === 1) keyName = keyName.toUpperCase();

    // Modifier olmadan tek tus: sadece F tuslarini ve ozel tuslari kabul et
    const isSafe = /^F\d{1,2}$/.test(keyName) || ["Pause", "PrintScreen", "ScrollLock", "Insert"].includes(keyName);
    if (parts.length === 0 && !isSafe) {
      setShortcutError("Tek tus icin Ctrl, Alt veya Shift ekleyin (F tuslari haric)");
      return;
    }

    parts.push(keyName);
    setShortcutInput(parts.join("+"));
  };

  const handleShortcutSave = async () => {
    if (!shortcutInput || shortcutInput === appSettings.ttsShortcut) {
      setEditingShortcut(false);
      invoke("resume_shortcuts");
      return;
    }
    try {
      // resume_shortcuts change_tts_shortcut icinde zaten kisayollari yeniden kaydeder
      invoke("resume_shortcuts");
      await changeTtsShortcutCmd(shortcutInput, true);
      updateSettings({ ttsShortcut: shortcutInput });
      const { saveSettings: saveFn } = await import("../lib/tauri-commands");
      const backendSettings = toBackend({ ...appSettings, ttsShortcut: shortcutInput });
      await saveFn(backendSettings);
      await emit("settings-changed", { ...appSettings, ttsShortcut: shortcutInput });
      setEditingShortcut(false);
      setShortcutError("");
    } catch (e: any) {
      setShortcutError(e?.toString() || "Kisayol atanamadi");
    }
  };

  return (
    <div className="settings-panel">
      {/* Metin alani */}
      <Section title="Metin" icon={icons.text}>
        <div className="tts-textarea-wrap">
          <textarea
            className="tts-textarea"
            placeholder="Seslendirmek istediginiz metni buraya yazin veya yapistirin..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
          />
          <div className="tts-textarea-footer">
            <span className="tts-char-count">{text.length} karakter</span>
            <button className="tts-paste-btn" onClick={handlePaste}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Panodan Yapistir
            </button>
          </div>
        </div>

        {/* Oynatma kontrolleri */}
        <div className="tts-controls">
          <button
            className={`tts-play-btn ${status === "speaking" ? "is-speaking" : status === "paused" ? "is-paused" : status === "loading" ? "is-loading" : ""}`}
            onClick={handlePlay}
            disabled={(status === "idle" && !text.trim()) || status === "loading"}
          >
            {status === "loading" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="tts-spinner">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : status === "speaking" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>

          <button
            className="tts-stop-btn"
            onClick={handleStop}
            disabled={status === "idle"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>

          {/* Ilerleme cubugu */}
          <div className="tts-progress">
            <div
              className={`tts-progress-fill ${status === "loading" ? "is-loading" : ""}`}
              style={{ width: status === "loading" ? "100%" : `${progress}%` }}
            />
          </div>
        </div>

        {status === "loading" && (
          <div className="tts-loading-text">Ses hazirlaniyor...</div>
        )}
      </Section>

      {/* Ses ayarlari */}
      <Section title="Ses Ayarlari" icon={icons.speaker}>
        <Item title="Motor" desc={isEdge ? "Microsoft yapay zeka sesleri" : "Sistem yerlesik sesleri"}>
          <Sel
            value={ttsSettings.engine}
            options={[
              { id: "edge", name: "Dogal Ses (Edge)" },
              { id: "browser", name: "Normal Ses (Sistem)" },
            ]}
            onChange={handleEngineChange}
          />
        </Item>

        <Item title="Dil" desc="Seslendirme dili">
          <Sel
            value={currentLang}
            options={TTS_LANGUAGES.map((l) => ({
              id: l.id,
              name: `${l.flag} ${l.name}`,
            }))}
            onChange={handleLanguageChange}
          />
        </Item>

        <Item title="Ses" desc={
          voiceOptions.length === 0
            ? "Bu dil icin ses bulunamadi"
            : isEdge
            ? `${voiceOptions.length} dogal ses mevcut`
            : `${voiceOptions.length} sistem sesi mevcut`
        }>
          <Sel
            value={ttsSettings.selectedVoice}
            options={voiceOptions.length > 0 ? voiceOptions : [{ id: "", name: "Ses bulunamadi" }]}
            onChange={handleVoiceChange}
          />
        </Item>

        <RangeSlider
          label="Hiz"
          value={ttsSettings.rate}
          min={0.25}
          max={4}
          step={0.25}
          unit="x"
          onChange={handleRateChange}
          fmt={(v) => `${v}x`}
        />

        <RangeSlider
          label="Perde"
          value={ttsSettings.pitch}
          min={0}
          max={2}
          step={0.1}
          unit=""
          onChange={handlePitchChange}
          fmt={(v) => v.toFixed(1)}
        />

        <RangeSlider
          label="Ses Seviyesi"
          value={ttsSettings.volume}
          min={0}
          max={1}
          step={0.1}
          unit=""
          onChange={handleVolumeChange}
          fmt={(v) => `${Math.round(v * 100)}%`}
        />

        <div className="tts-test-wrap">
          <button className="tts-test-btn" onClick={handleTestVoice} disabled={status === "loading" || voiceOptions.length === 0}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
            Sesi Dene
          </button>
        </div>
      </Section>

      {/* Kisayol ayari */}
      <Section title="Kisayol" icon={icons.shortcut}>
        <Item title="TTS Kisayolu" desc="Herhangi bir uygulamada secili metni seslendirir">
          {!editingShortcut ? (
            <button
              className="sp-shortcut-display"
              onClick={() => {
                setEditingShortcut(true);
                setShortcutInput(appSettings.ttsShortcut || "Ctrl+Shift+R");
                setShortcutError("");
                invoke("suspend_shortcuts");
              }}
            >
              {(appSettings.ttsShortcut || "Ctrl+Shift+R").split("+").map((k) => (
                <kbd key={k} className="sp-kbd">{k}</kbd>
              ))}
            </button>
          ) : (
            <div className="sp-shortcut-edit">
              <input
                type="text"
                className="sp-shortcut-input"
                value={shortcutInput}
                onKeyDown={handleShortcutKeyDown}
                onChange={() => {}}
                placeholder="Tuslara basin..."
                autoFocus
              />
              <button className="sp-shortcut-save" onClick={handleShortcutSave}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
              </button>
              <button className="sp-shortcut-cancel" onClick={() => { setEditingShortcut(false); setShortcutError(""); invoke("resume_shortcuts"); }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          )}
        </Item>
        {shortcutError && (
          <div className="sp-shortcut-error">{shortcutError}</div>
        )}
      </Section>
    </div>
  );
}

function toBackend(s: AppSettings & { ttsShortcut?: string }) {
  return {
    selected_model: s.selectedModel, selected_device: s.selectedDevice,
    theme: s.theme, shortcut: s.shortcut, recording_mode: s.recordingMode,
    vad_threshold: s.vadThreshold, auto_paste: s.autoPaste,
    language: s.language, transcription_engine: s.transcriptionEngine,
    deepgram_api_key: s.deepgramApiKey, azure_speech_key: s.azureSpeechKey,
    azure_speech_region: s.azureSpeechRegion, google_cloud_api_key: s.googleCloudApiKey,
    voice_activation: s.voiceActivation, wake_word: s.wakeWord,
    sound_enabled: s.soundEnabled, auto_start: s.autoStart,
    silence_timeout: s.silenceTimeout, max_record_duration: s.maxRecordDuration,
    turkish_corrections: s.turkishCorrections, hallucination_filter: s.hallucinationFilter,
    overlay_follow_cursor: s.overlayFollowCursor,
    auto_punctuation: s.autoPunctuation, auto_capitalization: s.autoCapitalization,
    preserve_english_words: s.preserveEnglishWords, auto_comma: s.autoComma,
    paragraph_break: s.paragraphBreak,
    notifications: s.notifications, log_level: s.logLevel,
    tts_shortcut: s.ttsShortcut ?? "Ctrl+Shift+R",
  };
}
