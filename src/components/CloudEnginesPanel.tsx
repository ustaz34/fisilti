import React, { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { useSettingsStore, type AppSettings } from "../stores/settingsStore";
import { useUsageStore } from "../stores/usageStore";
import { saveSettings } from "../lib/tauri-commands";

/* ════════════════════════════════════════
   Helpers
   ════════════════════════════════════════ */

function toBackend(s: AppSettings) {
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
  };
}

/* ════════════════════════════════════════
   Micro-components (sp-* CSS ile uyumlu)
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
  title, desc, children,
}: {
  title: string; desc?: string; children?: React.ReactNode;
}) {
  return (
    <div className="sp-item">
      <div className="sp-item-text">
        <span className="sp-item-title">{title}</span>
        {desc && <span className="sp-item-desc">{desc}</span>}
      </div>
      {children && <div className="sp-item-ctrl">{children}</div>}
    </div>
  );
}

/* ════════════════════════════════════════
   Icons
   ════════════════════════════════════════ */

const icons = {
  deepgram: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  azure: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12h8M12 8v8"/>
    </svg>
  ),
  google: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
    </svg>
  ),
  usage: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M18 20V10M12 20V4M6 20v-6"/>
    </svg>
  ),
};

/* ════════════════════════════════════════
   API Key Input
   ════════════════════════════════════════ */

function ApiKeyInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="sp-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <span className="sp-item-title" style={{ fontSize: 10.5 }}>{label}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "API Key"}
          className="sp-text-input"
          style={{ flex: 1, fontSize: 11 }}
        />
        <button
          onClick={() => setVisible(!visible)}
          className="sp-shortcut"
          style={{ padding: "4px 8px", fontSize: 9 }}
          title={visible ? "Gizle" : "Goster"}
        >
          {visible ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Usage Progress Bar
   ════════════════════════════════════════ */

function UsageBar({
  label,
  used,
  total,
  unit,
  onReset,
}: {
  label: string;
  used: number;
  total: number;
  unit: string;
  onReset: () => void;
}) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isOver = pct >= 90;

  return (
    <div className="sp-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="sp-item-title" style={{ fontSize: 10.5 }}>{label}</span>
        <span style={{
          fontSize: 9,
          color: isOver ? "#f87171" : "rgba(255,255,255,0.35)",
          fontFamily: "monospace",
        }}>
          {used.toFixed(1)} / {total} {unit}
        </span>
      </div>
      <div style={{
        height: 4,
        borderRadius: 2,
        background: "rgba(var(--accent-rgb), 0.08)",
        overflow: "hidden",
      }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 2,
          background: isOver
            ? "linear-gradient(90deg, #f87171, #ef4444)"
            : "linear-gradient(90deg, rgba(var(--accent-rgb), 0.4), rgba(var(--accent-rgb), 0.7))",
          transition: "width 0.3s ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
          Kalan: {Math.max(0, total - used).toFixed(1)} {unit}
        </span>
        <button
          onClick={onReset}
          style={{
            fontSize: 9,
            color: "rgba(255,255,255,0.3)",
            background: "rgba(var(--accent-rgb), 0.06)",
            border: "1px solid rgba(var(--accent-rgb), 0.1)",
            borderRadius: 6,
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          Sifirla
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Test Button
   ════════════════════════════════════════ */

function TestButton({
  onClick,
  testing,
  result,
}: {
  onClick: () => void;
  testing: boolean;
  result: string;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button
        onClick={onClick}
        disabled={testing}
        style={{
          fontSize: 10,
          color: testing ? "rgba(255,255,255,0.3)" : "rgba(var(--accent-rgb), 0.8)",
          background: "rgba(var(--accent-rgb), 0.08)",
          border: "1px solid rgba(var(--accent-rgb), 0.15)",
          borderRadius: 8,
          padding: "5px 14px",
          cursor: testing ? "wait" : "pointer",
          transition: "all 0.2s",
        }}
      >
        {testing ? "Test ediliyor..." : "Test Et"}
      </button>
      {result && (
        <span style={{
          fontSize: 9,
          color: result.startsWith("Basarili") ? "#4ade80" : "#f87171",
          maxWidth: 200,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {result}
        </span>
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   Main Panel
   ════════════════════════════════════════ */

export function CloudEnginesPanel() {
  const { settings, updateSettings } = useSettingsStore();
  const usage = useUsageStore();

  // Kullanim verisini yukle
  useEffect(() => {
    usage.loadFromDisk().catch(() => {});
  }, []);

  const save = (partial: Partial<AppSettings>) => {
    updateSettings(partial);
    setTimeout(async () => {
      const cur = useSettingsStore.getState().settings;
      try {
        await saveSettings(toBackend(cur));
        await emit("settings-changed", cur);
      } catch (e) {
        console.error("Save error:", e);
      }
    }, 0);
  };

  // Test durumlari
  const [deepgramTest, setDeepgramTest] = useState({ testing: false, result: "" });
  const [azureTest, setAzureTest] = useState({ testing: false, result: "" });
  const [googleTest, setGoogleTest] = useState({ testing: false, result: "" });

  const testDeepgram = async () => {
    if (!settings.deepgramApiKey) {
      setDeepgramTest({ testing: false, result: "API key girilmemis" });
      return;
    }
    setDeepgramTest({ testing: true, result: "" });
    try {
      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-3&language=tr`,
        ["token", settings.deepgramApiKey],
      );
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => { ws.close(); resolve(); };
        ws.onerror = () => reject(new Error("Baglanti hatasi"));
        setTimeout(() => reject(new Error("Zaman asimi")), 5000);
      });
      setDeepgramTest({ testing: false, result: "Basarili! Baglanti kuruldu." });
    } catch (err) {
      setDeepgramTest({ testing: false, result: `Hata: ${err}` });
    }
  };

  const testAzure = async () => {
    if (!settings.azureSpeechKey || !settings.azureSpeechRegion) {
      setAzureTest({ testing: false, result: "Key ve region girilmeli" });
      return;
    }
    setAzureTest({ testing: true, result: "" });
    try {
      const url = `https://${settings.azureSpeechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": settings.azureSpeechKey },
      });
      if (resp.ok) {
        setAzureTest({ testing: false, result: "Basarili! Token alindi." });
      } else {
        setAzureTest({ testing: false, result: `Hata: HTTP ${resp.status}` });
      }
    } catch (err) {
      setAzureTest({ testing: false, result: `Hata: ${err}` });
    }
  };

  const testGoogleCloud = async () => {
    if (!settings.googleCloudApiKey) {
      setGoogleTest({ testing: false, result: "API key girilmemis" });
      return;
    }
    setGoogleTest({ testing: true, result: "" });
    try {
      // Bos audio ile test — API key dogrulama
      const url = `https://speech.googleapis.com/v2/projects/-/locations/global/recognizers/_:recognize`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": settings.googleCloudApiKey,
        },
        body: JSON.stringify({
          config: { languageCodes: ["tr-TR"], model: "chirp_2" },
          content: "",
        }),
      });
      if (resp.ok || resp.status === 400) {
        // 400 = gecerli key ama bos audio (beklenen)
        setGoogleTest({ testing: false, result: "Basarili! API key gecerli." });
      } else if (resp.status === 403 || resp.status === 401) {
        setGoogleTest({ testing: false, result: "Hata: Gecersiz API key" });
      } else {
        setGoogleTest({ testing: false, result: `Hata: HTTP ${resp.status}` });
      }
    } catch (err) {
      setGoogleTest({ testing: false, result: `Hata: ${err}` });
    }
  };

  return (
    <div className="sp-root">

      {/* ── Deepgram ── */}
      <Section title="Deepgram Nova-3" icon={icons.deepgram}>
        <Item title="Streaming" desc="WebSocket ile gercek zamanli transkripsyon. $200 ucretsiz kredi." />
        <ApiKeyInput
          label="Deepgram API Key"
          value={settings.deepgramApiKey}
          onChange={(v) => save({ deepgramApiKey: v })}
          placeholder="dg_..."
        />
        <div className="sp-item">
          <TestButton onClick={testDeepgram} testing={deepgramTest.testing} result={deepgramTest.result} />
        </div>
      </Section>

      {/* ── Azure ── */}
      <Section title="Azure Speech Services" icon={icons.azure}>
        <Item title="Streaming" desc="SDK ile gercek zamanli tanima. 5 saat/ay ucretsiz." />
        <ApiKeyInput
          label="Azure Speech Key"
          value={settings.azureSpeechKey}
          onChange={(v) => save({ azureSpeechKey: v })}
          placeholder="Subscription key"
        />
        <div className="sp-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
          <span className="sp-item-title" style={{ fontSize: 10.5 }}>Azure Region</span>
          <input
            type="text"
            value={settings.azureSpeechRegion}
            onChange={(e) => save({ azureSpeechRegion: e.target.value })}
            placeholder="westeurope, eastus, ..."
            className="sp-text-input"
            style={{ fontSize: 11 }}
          />
        </div>
        <div className="sp-item">
          <TestButton onClick={testAzure} testing={azureTest.testing} result={azureTest.result} />
        </div>
      </Section>

      {/* ── Google Cloud ── */}
      <Section title="Google Cloud Speech V2" icon={icons.google}>
        <Item title="Batch" desc="Kayit bitince REST ile transkripsiyon. 60 dk/ay ucretsiz." />
        <ApiKeyInput
          label="Google Cloud API Key"
          value={settings.googleCloudApiKey}
          onChange={(v) => save({ googleCloudApiKey: v })}
          placeholder="AIza..."
        />
        <div className="sp-item">
          <TestButton onClick={testGoogleCloud} testing={googleTest.testing} result={googleTest.result} />
        </div>
      </Section>

      {/* ── Kullanim Takibi ── */}
      <Section title="Kullanim Takibi" icon={icons.usage}>
        <UsageBar
          label="Deepgram"
          used={usage.deepgram.minutesUsed}
          total={20000}
          unit="dk"
          onReset={() => usage.resetProvider("deepgram")}
        />
        <UsageBar
          label="Azure Speech"
          used={usage.azure.minutesUsed}
          total={300}
          unit="dk"
          onReset={() => usage.resetProvider("azure")}
        />
        <UsageBar
          label="Google Cloud"
          used={usage.googleCloud.minutesUsed}
          total={60}
          unit="dk"
          onReset={() => usage.resetProvider("googleCloud")}
        />
        <Item title="Aylik reset" desc={`Son reset: ${usage.deepgram.lastResetDate}`} />
      </Section>

    </div>
  );
}
