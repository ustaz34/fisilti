import React, { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { SettingsPanel } from "./SettingsPanel";
import { StatsPanel } from "./StatsPanel";
import { ModelManager } from "./ModelManager";
import { LearningPanel } from "./LearningPanel";
import { HistoryPanel } from "./HistoryPanel";
import { ColorsPanel } from "./ColorsPanel";
import { CloudEnginesPanel } from "./CloudEnginesPanel";
import { TTSPanel } from "./TTSPanel";
import { useSettingsStore, type AppSettings } from "../stores/settingsStore";
import { useTranscriptionStore } from "../stores/transcriptionStore";
import { useRecordingStore } from "../stores/recordingStore";
import { useTTSStore } from "../stores/ttsStore";
import { getTTSService } from "../lib/ttsService";
import { getSettings } from "../lib/tauri-commands";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { listen } from "@tauri-apps/api/event";

type Tab = "general" | "cloud" | "models" | "stats" | "learning" | "history" | "colors" | "seslendir" | "about";

const TAB_TITLES: Record<Tab, string> = {
  general: "Genel Ayarlar",
  cloud: "Bulut Motorlari",
  models: "Modeller",
  stats: "Istatistikler",
  learning: "Ogrenme",
  history: "Gecmis",
  colors: "Renkler",
  seslendir: "Seslendir",
  about: "Hakkinda",
};

export function SettingsApp() {
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [closing, setClosing] = useState(false);
  const [splash, setSplash] = useState<"visible" | "fading" | "gone">("visible");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const appWindow = getCurrentWindow();
  const { updateSettings } = useSettingsStore();

  // Splash screen zamanlayicisi
  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplash("fading"), 1800);
    const hideTimer = setTimeout(() => setSplash("gone"), 2200);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    getSettings()
      .then((saved) => {
        updateSettings({
          selectedModel: saved.selected_model,
          selectedDevice: saved.selected_device ?? null,
          theme: saved.theme as "dark" | "light",
          shortcut: saved.shortcut,
          recordingMode: saved.recording_mode as "button" | "auto" | "shortcut",
          vadThreshold: saved.vad_threshold,
          autoPaste: saved.auto_paste,
          language: saved.language,
          transcriptionEngine: (saved.transcription_engine as "whisper" | "web" | "deepgram" | "azure" | "google-cloud") || "web",
          deepgramApiKey: saved.deepgram_api_key ?? "",
          azureSpeechKey: saved.azure_speech_key ?? "",
          azureSpeechRegion: saved.azure_speech_region ?? "",
          googleCloudApiKey: saved.google_cloud_api_key ?? "",
          voiceActivation: saved.voice_activation ?? false,
          wakeWord: saved.wake_word ?? "fısıltı",
          soundEnabled: saved.sound_enabled ?? true,
          autoStart: saved.auto_start ?? false,
          silenceTimeout: saved.silence_timeout ?? 4,
          maxRecordDuration: saved.max_record_duration ?? 60,
          turkishCorrections: saved.turkish_corrections ?? true,
          hallucinationFilter: saved.hallucination_filter ?? true,
          overlayFollowCursor: saved.overlay_follow_cursor ?? true,
          autoPunctuation: saved.auto_punctuation ?? true,
          autoCapitalization: saved.auto_capitalization ?? true,
          preserveEnglishWords: saved.preserve_english_words ?? true,
          autoComma: saved.auto_comma ?? true,
          paragraphBreak: saved.paragraph_break ?? false,
          notifications: saved.notifications ?? true,
          logLevel: saved.log_level ?? "info",
          ttsShortcut: saved.tts_shortcut ?? "Ctrl+Shift+R",
        });
      })
      .catch(console.error);

    useTranscriptionStore.getState().loadHistory();
  }, []);

  useEffect(() => {
    const unlisten = listen<AppSettings>("settings-changed", (event) => {
      updateSettings(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [updateSettings]);

  useEffect(() => {
    const unlistenHistory = listen("history-updated", () => {
      useTranscriptionStore.getState().loadHistory();
    });
    return () => {
      unlistenHistory.then((fn) => fn());
    };
  }, []);

  // Wake word durum bildirimlerini overlay penceresinden dinle
  useEffect(() => {
    const unlisten = listen<{ status: string; error: string | null }>("wake-word-status", (event) => {
      const { status, error } = event.payload;
      useSettingsStore.getState().setWakeWordStatus(
        status as import("../stores/settingsStore").WakeWordStatus,
        error,
      );
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        useTranscriptionStore.getState().loadHistory();
        getSettings()
          .then((saved) => {
            updateSettings({
              selectedModel: saved.selected_model,
              selectedDevice: saved.selected_device ?? null,
              theme: saved.theme as "dark" | "light",
              shortcut: saved.shortcut,
              recordingMode: saved.recording_mode as "button" | "auto" | "shortcut",
              vadThreshold: saved.vad_threshold,
              autoPaste: saved.auto_paste,
              language: saved.language,
              transcriptionEngine: (saved.transcription_engine as "whisper" | "web" | "deepgram" | "azure" | "google-cloud") || "web",
              deepgramApiKey: saved.deepgram_api_key ?? "",
              azureSpeechKey: saved.azure_speech_key ?? "",
              azureSpeechRegion: saved.azure_speech_region ?? "",
              googleCloudApiKey: saved.google_cloud_api_key ?? "",
              voiceActivation: saved.voice_activation ?? false,
              wakeWord: saved.wake_word ?? "fısıltı",
              soundEnabled: saved.sound_enabled ?? true,
              autoStart: saved.auto_start ?? false,
              silenceTimeout: saved.silence_timeout ?? 4,
              maxRecordDuration: saved.max_record_duration ?? 60,
              turkishCorrections: saved.turkish_corrections ?? true,
              hallucinationFilter: saved.hallucination_filter ?? true,
              overlayFollowCursor: saved.overlay_follow_cursor ?? true,
              autoPunctuation: saved.auto_punctuation ?? true,
              autoCapitalization: saved.auto_capitalization ?? true,
              preserveEnglishWords: saved.preserve_english_words ?? true,
              autoComma: saved.auto_comma ?? true,
              paragraphBreak: saved.paragraph_break ?? false,
              notifications: saved.notifications ?? true,
              logLevel: saved.log_level ?? "info",
              ttsShortcut: saved.tts_shortcut ?? "Ctrl+Shift+R",
            });
          })
          .catch(console.error);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // TTS: Panodan oku event'i (global kisayol + tray menu)
  useEffect(() => {
    // tts-read-clipboard: eski format (panoyu frontend okur)
    const unlisten1 = listen("tts-read-clipboard", async () => {
      try {
        const clipText = await readText();
        if (clipText && clipText.trim()) {
          getTTSService().speak(clipText);
        }
      } catch (e) {
        console.error("TTS pano okuma hatasi:", e);
      }
    });
    // tts-speak-text: yeni format (metin dogrudan Rust'tan gelir)
    const unlisten2 = listen<string>("tts-speak-text", (event) => {
      const text = event.payload;
      if (text && text.trim()) {
        getTTSService().speak(text);
      }
    });
    return () => {
      unlisten1.then((fn) => fn());
      unlisten2.then((fn) => fn());
    };
  }, []);

  // TTS: overlay'den gelen kontrol komutlari (pause/resume/stop)
  useEffect(() => {
    const unlisten = listen<{ action: string }>("tts-control", (event) => {
      const { action } = event.payload;
      const svc = getTTSService();
      if (action === "pause") svc.pause();
      else if (action === "resume") svc.resume();
      else if (action === "stop") svc.stop();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      invoke("hide_main_window").catch(console.error);
      setClosing(false);
    }, 1200);
  };

  // Splash screen
  if (splash !== "gone") {
    return (
      <div className={`w-full h-screen bg-[var(--color-bg-primary)] rounded-2xl overflow-hidden flex flex-col items-center justify-center shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.4)] ${splash === "fading" ? "splash-out" : ""}`}>
        <img
          src="/logo.png"
          alt="Fisilti"
          className="splash-logo w-20 h-20 rounded-[22px] object-cover"
        />
        <p className="splash-text mt-5 text-sm font-semibold text-[rgba(var(--accent-rgb),0.7)] tracking-[0.2em]">
          FISILTI
        </p>
        <p className="splash-text mt-2 text-[10px] text-[rgba(255,255,255,0.25)]" style={{ animationDelay: "0.6s" }}>
          Ses-yazi donusturucu
        </p>
      </div>
    );
  }

  return (
    <div className={`w-full h-screen bg-[var(--color-bg-primary)] rounded-2xl overflow-hidden flex shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_32px_rgba(0,0,0,0.4)] transition-[opacity,transform] duration-300 ${closing ? "opacity-0 scale-95" : "opacity-100 scale-100"}`}>

      {/* Kapanis bildirimi */}
      {closing && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl" style={{ background: "rgba(var(--bg-primary-rgb), 0.95)" }}>
          <div className="flex flex-col items-center gap-3 animate-fade-in">
            <img
              src="/logo.png"
              alt="Fisilti"
              className="w-12 h-12 rounded-[14px] object-cover shadow-[0_2px_12px_rgba(var(--accent-rgb),0.2)]"
            />
            <p className="text-xs text-[rgba(var(--accent-rgb),0.6)]">Arka planda calismaya devam ediyor</p>
          </div>
        </div>
      )}

      {/* ─── Sidebar ─── */}
      <aside
        className={`sidebar-glass sidebar-transition h-full flex flex-col border-r border-[rgba(var(--accent-rgb),0.08)] flex-shrink-0 overflow-hidden ${
          sidebarExpanded ? "w-[180px]" : "w-[54px]"
        }`}
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
      >
        {/* Logo - drag area */}
        <div
          className={`flex items-center cursor-move flex-shrink-0 ${
            sidebarExpanded
              ? "px-4 gap-3 h-[52px]"
              : "justify-center h-[48px]"
          }`}
          onMouseDown={() => appWindow.startDragging()}
        >
          <img
            src="/logo.png"
            alt=""
            className={`rounded-[9px] object-cover flex-shrink-0 transition-[width,height] duration-300 ${
              sidebarExpanded
                ? "w-7 h-7 shadow-[0_2px_8px_rgba(var(--accent-rgb),0.15)]"
                : "w-[26px] h-[26px] shadow-[0_1px_6px_rgba(var(--accent-rgb),0.12)]"
            }`}
          />
          {sidebarExpanded && (
            <span className="nav-label-enter text-[11.5px] font-bold text-[rgba(var(--accent-rgb),0.6)] tracking-[0.14em] whitespace-nowrap">
              FISILTI
            </span>
          )}
        </div>

        {/* Ayirici cizgi */}
        <div className={`flex-shrink-0 mx-auto mb-1.5 h-px ${
          sidebarExpanded ? "w-[calc(100%-32px)]" : "w-6"
        } bg-[rgba(var(--accent-rgb),0.06)]`} />

        {/* Navigation buttons */}
        <nav className={`flex flex-col gap-1 flex-1 min-h-0 ${sidebarExpanded ? "w-full px-2" : "items-center"}`}>
          <NavButton active={activeTab === "general"} label="Genel" expanded={sidebarExpanded} onClick={() => setActiveTab("general")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v4M12 19v4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M1 12h4M19 12h4M4.2 19.8l2.8-2.8M17 7l2.8-2.8"/>
            </svg>
          </NavButton>

          <NavButton active={activeTab === "cloud"} label="Bulut" expanded={sidebarExpanded} onClick={() => setActiveTab("cloud")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
            </svg>
          </NavButton>

          <NavButton active={activeTab === "models"} label="Modeller" expanded={sidebarExpanded} onClick={() => setActiveTab("models")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
            </svg>
          </NavButton>

          <NavButton active={activeTab === "stats"} label="Istatistik" expanded={sidebarExpanded} onClick={() => setActiveTab("stats")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M18 20V10M12 20V4M6 20v-6"/>
            </svg>
          </NavButton>

          <NavButton active={activeTab === "learning"} label="Ogrenme" expanded={sidebarExpanded} onClick={() => setActiveTab("learning")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </NavButton>

          <NavButton active={activeTab === "history"} label="Gecmis" expanded={sidebarExpanded} onClick={() => setActiveTab("history")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </NavButton>

          <NavButton active={activeTab === "colors"} label="Renkler" expanded={sidebarExpanded} onClick={() => setActiveTab("colors")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="13.5" cy="6.5" r="2.5"/>
              <circle cx="17.5" cy="10.5" r="2.5"/>
              <circle cx="8.5" cy="7.5" r="2.5"/>
              <circle cx="6.5" cy="12.5" r="2.5"/>
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.1-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-5.5-4.5-9-10-9z"/>
            </svg>
          </NavButton>

          <NavButton active={activeTab === "seslendir"} label="Seslendir" expanded={sidebarExpanded} onClick={() => setActiveTab("seslendir")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          </NavButton>

          <NavButton active={activeTab === "about"} label="Hakkinda" expanded={sidebarExpanded} onClick={() => setActiveTab("about")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
          </NavButton>
        </nav>

        {/* Bottom: status indicator */}
        <div className={`flex-shrink-0 pb-3 flex items-center gap-2 ${
          sidebarExpanded ? "px-4" : "justify-center"
        }`}>
          <SidebarStatusDot expanded={sidebarExpanded} />
        </div>
      </aside>

      {/* ─── Icerik Alani ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Baslik cubugu */}
        <div className="flex items-center justify-between h-11 px-5 flex-shrink-0 select-none">
          <div
            className="flex-1 h-full flex items-center cursor-move"
            onMouseDown={() => appWindow.startDragging()}
          >
            <h1 className="text-[13px] font-semibold text-[rgba(255,255,255,0.7)] tracking-wide">
              {TAB_TITLES[activeTab]}
            </h1>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg
                       text-[rgba(255,255,255,0.18)] hover:text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.06)]
                       transition-colors duration-200"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Durum cubugu */}
        <StatusBar />

        {/* Sekme icerigi */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {activeTab === "general" && <GeneralTab />}
          {activeTab === "cloud" && <CloudTab />}
          {activeTab === "models" && <ModelsTab />}
          {activeTab === "stats" && <StatsTab />}
          {activeTab === "learning" && <LearningTab />}
          {activeTab === "history" && <HistoryTab />}
          {activeTab === "colors" && <ColorsTab />}
          {activeTab === "seslendir" && <SeslendirTab />}
          {activeTab === "about" && <AboutTab />}
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar Navigasyon Butonu ───

function NavButton({
  active,
  label,
  expanded,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  expanded: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = active
    ? "bg-[rgba(var(--accent-rgb),0.1)] text-[var(--color-accent)]"
    : "text-[rgba(255,255,255,0.22)] hover:text-[rgba(255,255,255,0.5)] hover:bg-[rgba(var(--accent-rgb),0.05)]";

  const indicator = active && (
    <div className="absolute -right-[1px] top-1/2 -translate-y-1/2 w-[2.5px] h-3.5 bg-[var(--color-accent)] rounded-l-full shadow-[0_0_6px_rgba(var(--accent-rgb),0.3)]" />
  );

  if (expanded) {
    return (
      <button
        onClick={onClick}
        className={`relative w-full px-3 h-9 flex items-center gap-2.5 rounded-xl transition-colors duration-200 ${base}`}
      >
        {indicator}
        <span className="flex-shrink-0">{children}</span>
        <span className="nav-label-enter text-[11px] font-medium whitespace-nowrap">{label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`relative w-9 h-9 flex items-center justify-center rounded-xl transition-colors duration-200 group ${base}`}
    >
      {indicator}
      {children}
      <span className="absolute left-full ml-3 bg-[var(--color-bg-dark)] text-[rgba(255,255,255,0.65)] text-[10px] font-medium px-2.5 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none whitespace-nowrap border border-[rgba(var(--accent-rgb),0.1)] shadow-[0_4px_12px_rgba(0,0,0,0.3)] z-50">
        {label}
      </span>
    </button>
  );
}

// ─── Sidebar Durum Noktasi ───

function SidebarStatusDot({ expanded }: { expanded: boolean }) {
  const { isRecording } = useRecordingStore();
  const { isTranscribing } = useTranscriptionStore();

  const statusText = isRecording ? "Kayit" : isTranscribing ? "Donusum" : "Hazir";

  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2.5 h-2.5 rounded-full transition-[background,box-shadow] duration-300 flex-shrink-0 ${
          isRecording
            ? "bg-[var(--color-accent)] shadow-[0_0_8px_rgba(var(--accent-rgb),0.5)] animate-pulse"
            : isTranscribing
              ? "bg-[var(--color-accent)]/60 animate-pulse"
              : "bg-[rgba(var(--accent-rgb),0.12)]"
        }`}
        title={statusText}
      />
      {expanded && (
        <span className={`nav-label-enter text-[10px] whitespace-nowrap ${
          isRecording
            ? "text-[var(--color-accent)]"
            : isTranscribing
              ? "text-[rgba(var(--accent-rgb),0.5)]"
              : "text-[rgba(255,255,255,0.2)]"
        }`}>
          {statusText}
        </span>
      )}
    </div>
  );
}

// ─── Durum Cubugu ───

function StatusBar() {
  const { isRecording, duration } = useRecordingStore();
  const { isTranscribing, currentText } = useTranscriptionStore();
  const { settings } = useSettingsStore();
  const ttsStatus = useTTSStore((s) => s.status);

  return (
    <div className="mx-4 mb-2 px-3.5 py-2.5 rounded-xl bg-[rgba(var(--accent-rgb),0.03)] border border-[rgba(var(--accent-rgb),0.06)]">
      <div className="flex items-center gap-2">
        <div
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            isRecording
              ? "bg-[var(--color-accent)] shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)] animate-pulse"
              : isTranscribing
                ? "bg-[var(--color-accent)]/60 animate-pulse"
                : ttsStatus === "loading"
                  ? "bg-[var(--color-accent)]/50 animate-pulse"
                  : ttsStatus === "speaking"
                    ? "bg-[var(--color-accent)] shadow-[0_0_6px_rgba(var(--accent-rgb),0.4)] tts-pulse"
                    : ttsStatus === "paused"
                      ? "bg-[var(--color-accent)]/40"
                      : "bg-[rgba(var(--accent-rgb),0.15)]"
          }`}
        />
        <span className="text-[10px] text-[rgba(255,255,255,0.4)] flex-1">
          {isRecording
            ? `Kayit yapiliyor... ${duration}s`
            : isTranscribing
              ? "Donusturuluyor..."
              : ttsStatus === "loading"
                ? "Ses hazirlaniyor..."
                : ttsStatus === "speaking"
                  ? "Seslendiriliyor..."
                  : ttsStatus === "paused"
                    ? "Duraklatildi"
                    : "Hazir"}
        </span>
        <span className="text-[9px] text-[rgba(255,255,255,0.18)] font-mono">
          {settings.transcriptionEngine === "web" ? "Web Speech"
            : settings.transcriptionEngine === "deepgram" ? "Deepgram Nova-3"
            : settings.transcriptionEngine === "azure" ? "Azure Speech"
            : settings.transcriptionEngine === "google-cloud" ? "Google Cloud"
            : settings.selectedModel || "Model secilmedi"}
        </span>
      </div>

      {currentText && !isRecording && (
        <div className="text-[10px] text-[rgba(255,255,255,0.5)] bg-[rgba(var(--accent-rgb),0.04)] rounded-lg px-3 py-1.5 mt-2 max-h-11 overflow-y-auto leading-relaxed">
          {currentText}
        </div>
      )}
    </div>
  );
}

// ─── Sekme Icerikleri ───

function GeneralTab() {
  return (
    <div className="settings-content">
      <SettingsPanel />
    </div>
  );
}

function CloudTab() {
  return (
    <div className="settings-content">
      <CloudEnginesPanel />
    </div>
  );
}

function ModelsTab() {
  return (
    <div className="py-4 px-2">
      <ModelManager />
    </div>
  );
}

function StatsTab() {
  return (
    <div className="settings-content">
      <StatsPanel />
    </div>
  );
}

function LearningTab() {
  return (
    <div className="settings-content">
      <LearningPanel />
    </div>
  );
}

function HistoryTab() {
  return (
    <div className="settings-content">
      <HistoryPanel />
    </div>
  );
}

function ColorsTab() {
  return (
    <div className="settings-content">
      <ColorsPanel />
    </div>
  );
}

function SeslendirTab() {
  return (
    <div className="settings-content">
      <TTSPanel />
    </div>
  );
}

function AboutTab() {
  const FEATURES = [
    {
      title: "Cevrimdisi Donusum",
      desc: "Whisper AI ile internet baglantisi gerektirmeden yuksek dogruluklu ses-yazi donusum",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
        </svg>
      ),
    },
    {
      title: "Canli Donusum",
      desc: "Web Speech, Deepgram, Azure ve Google Cloud motorlariyla gercek zamanli donusum",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      ),
    },
    {
      title: "Metin Seslendirme",
      desc: "Edge TTS ile secili metni veya panodaki icerigi dogal seslerle oku",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      ),
    },
    {
      title: "Akilli Ogrenme",
      desc: "Yazim hatalarinizi ogrenip sonraki donusumlerde otomatik duzeltme",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a8 8 0 0 0-8 8c0 6 8 12 8 12s8-6 8-12a8 8 0 0 0-8-8z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      ),
    },
    {
      title: "Turkce Optimizasyon",
      desc: "Turkce dil bilgisi kurallari, noktalama ve ozel karakter duzeltme",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>
        </svg>
      ),
    },
    {
      title: "Global Kisayollar",
      desc: "Herhangi bir uygulamada tek tus veya kombinasyonla kayit ve seslendirme",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2"/>
          <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h8M6 16h.01M18 16h.01"/>
        </svg>
      ),
    },
  ];

  const SHORTCUTS = [
    { keys: ["Ctrl", "Shift", "Space"], desc: "Kaydi baslat / durdur" },
    { keys: ["Ctrl", "Shift", "S"], desc: "Ayarlar penceresini ac" },
    { keys: ["Ctrl", "Shift", "R"], desc: "Secili metni seslendir" },
    { keys: ["Esc"], desc: "Kaydi iptal et" },
  ];

  const TECH_STACK = [
    { name: "Tauri v2", color: "rgba(250, 228, 207, 0.15)" },
    { name: "Whisper AI", color: "rgba(250, 228, 207, 0.12)" },
    { name: "Edge TTS", color: "rgba(250, 228, 207, 0.10)" },
    { name: "React 19", color: "rgba(250, 228, 207, 0.10)" },
    { name: "Rust", color: "rgba(250, 228, 207, 0.12)" },
    { name: "Zustand", color: "rgba(250, 228, 207, 0.08)" },
  ];

  return (
    <div className="about-root">
      {/* Hero */}
      <div className="about-hero">
        <div className="about-logo-wrap">
          <div className="about-logo-glow" />
          <img
            src="/logo.png"
            alt="Fisilti"
            className="about-logo-img"
          />
        </div>
        <h2 className="about-title">FISILTI</h2>
        <span className="about-version">v2.0.0</span>
        <p className="about-desc">
          Profesyonel ses-yazi donusturucu ve metin seslendirici. Whisper AI, Web Speech, Deepgram,
          Azure ve Google Cloud motorlari ile guclendirilmis, Edge TTS ile metin seslendirme,
          akilli ogrenme ve Turkce optimizasyon sistemi ile desteklenmis masaustu uygulamasi.
        </p>
      </div>

      {/* Ozellikler */}
      <div className="about-section">
        <div className="about-section-head">
          <span className="about-section-title">Ozellikler</span>
          <div className="about-section-line" />
        </div>
        <div className="about-features-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="about-feature-card">
              <div className="about-feature-icon">{f.icon}</div>
              <h4 className="about-feature-title">{f.title}</h4>
              <p className="about-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Teknoloji */}
      <div className="about-section">
        <div className="about-section-head">
          <span className="about-section-title">Teknoloji</span>
          <div className="about-section-line" />
        </div>
        <div className="about-tech-grid">
          {TECH_STACK.map((t) => (
            <span
              key={t.name}
              className="about-tech-badge"
              style={{ background: t.color }}
            >
              {t.name}
            </span>
          ))}
        </div>
      </div>

      {/* Kisayollar */}
      <div className="about-section">
        <div className="about-section-head">
          <span className="about-section-title">Klavye Kisayollari</span>
          <div className="about-section-line" />
        </div>
        <div className="about-shortcuts">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="about-shortcut-row">
              <div className="about-shortcut-keys">
                {s.keys.map((k) => (
                  <kbd key={k} className="about-kbd">{k}</kbd>
                ))}
              </div>
              <span className="about-shortcut-desc">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Yapimci */}
      <div className="about-footer">
        <span className="about-footer-label">Yapimci</span>
        <span className="about-footer-name">ustaz</span>
        <span className="about-footer-year">2025 - 2026</span>
      </div>
    </div>
  );
}
