import { useEffect, useState, useRef } from "react";
import { emit } from "@tauri-apps/api/event";
import {
  listModels,
  downloadModel,
  getDownloadProgress,
  deleteModel,
  saveSettings,
  type WhisperModel,
  type DownloadProgress,
} from "../lib/tauri-commands";
import { useSettingsStore } from "../stores/settingsStore";

/* ── Model meta bilgileri ── */

type ModelCategory = "light" | "mid" | "heavy";

interface ModelMeta {
  category: ModelCategory;
  speed: number;  // 1-5
  quality: number; // 1-5
  recommended?: boolean;
}

const MODEL_META: Record<string, ModelMeta> = {
  "ggml-tiny":     { category: "light", speed: 5, quality: 1 },
  "ggml-tiny.en":  { category: "light", speed: 5, quality: 1 },
  "ggml-base":     { category: "light", speed: 4, quality: 2 },
  "ggml-base.en":  { category: "light", speed: 4, quality: 2 },
  "ggml-small":    { category: "mid",   speed: 3, quality: 3, recommended: true },
  "ggml-small.en": { category: "mid",   speed: 3, quality: 3 },
  "ggml-medium":   { category: "mid",   speed: 2, quality: 4 },
  "ggml-medium.en":{ category: "mid",   speed: 2, quality: 4 },
  "ggml-large-v3": { category: "heavy", speed: 1, quality: 5 },
  "ggml-large-v3-turbo": { category: "heavy", speed: 2, quality: 5 },
};

function getModelMeta(id: string): ModelMeta {
  return MODEL_META[id] ?? { category: "mid", speed: 3, quality: 3 };
}

const CATEGORY_INFO: Record<ModelCategory, { title: string; desc: string; icon: string }> = {
  light: {
    title: "Hafif Modeller",
    desc: "Hizli indirme, dusuk kaynak tuketimi. Basit donusumler icin ideal.",
    icon: "bolt",
  },
  mid: {
    title: "Orta Modeller",
    desc: "Hiz ve kalite arasinda dengeli secim. Cogu kullanim icin onerilen.",
    icon: "balance",
  },
  heavy: {
    title: "Buyuk Modeller",
    desc: "En yuksek dogruluk. GPU onerilen, daha fazla depolama gerektirir.",
    icon: "diamond",
  },
};

const CATEGORY_ORDER: ModelCategory[] = ["light", "mid", "heavy"];

/* ── Ikonlar ── */

function CategoryIcon({ type }: { type: string }) {
  if (type === "bolt") return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
  if (type === "balance") return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" /><path d="M3 7l9-4 9 4" />
      <path d="M3 7v4a9 9 0 0 0 6 0V7" /><path d="M15 7v4a9 9 0 0 0 6 0V7" />
    </svg>
  );
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/* ── Yildiz rating ── */

function RatingDots({ value, max = 5, label }: { value: number; max?: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-[rgba(255,255,255,0.2)] w-[32px]">{label}</span>
      <div className="flex gap-[3px]">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={`w-[5px] h-[5px] rounded-full transition-all duration-300 ${
              i < value
                ? "bg-[#fae4cf] shadow-[0_0_4px_rgba(250,228,207,0.3)]"
                : "bg-[rgba(255,255,255,0.06)]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Progress bar ── */

function ModelProgress({ progress, formatSize, formatSpeed }: {
  progress: DownloadProgress;
  formatSize: (b: number) => string;
  formatSpeed: (b: number) => string;
}) {
  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[rgba(255,255,255,0.45)] font-medium tabular-nums">
          %{progress.percent.toFixed(0)}
        </span>
        <span className="text-[9px] text-[rgba(255,255,255,0.25)] tabular-nums">
          {formatSpeed(progress.speed_bps)}
        </span>
      </div>
      <div className="w-full h-[6px] bg-[rgba(250,228,207,0.06)] rounded-full overflow-hidden">
        <div
          className="model-progress-fill h-full rounded-full transition-[width] duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <div className="flex justify-between">
        <span className="text-[9px] text-[rgba(255,255,255,0.18)] tabular-nums">
          {formatSize(progress.downloaded_bytes)}
        </span>
        <span className="text-[9px] text-[rgba(255,255,255,0.18)] tabular-nums">
          {formatSize(progress.total_bytes)}
        </span>
      </div>
    </div>
  );
}

/* ── Boyut bar ── */

function SizeBar({ sizeBytes, maxBytes }: { sizeBytes: number; maxBytes: number }) {
  const pct = Math.min((sizeBytes / maxBytes) * 100, 100);
  return (
    <div className="w-full h-[3px] bg-[rgba(250,228,207,0.04)] rounded-full overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[rgba(250,228,207,0.12)] to-[rgba(250,228,207,0.3)] transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════
   Ana Bilesen
   ══════════════════════════════════════════════ */

export function ModelManager() {
  const [models, setModels] = useState<WhisperModel[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const { settings, updateSettings } = useSettingsStore();
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const loadModels = async () => {
    try {
      const list = await listModels();
      setModels(list);
    } catch (err) {
      console.error("Model listesi alinamadi:", err);
    }
  };

  useEffect(() => {
    loadModels();
  }, []);

  useEffect(() => {
    if (downloading) {
      pollRef.current = setInterval(async () => {
        try {
          const p = await getDownloadProgress(downloading);
          if (p) {
            setProgress(p);
            if (p.status === "tamamlandi") {
              clearInterval(pollRef.current);
              setDownloading(null);
              setProgress(null);
              loadModels();
            }
          }
        } catch {
          // ignore
        }
      }, 500);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [downloading]);

  const handleDownload = async (modelId: string) => {
    setDownloading(modelId);
    try {
      await downloadModel(modelId);
    } catch (err) {
      console.error("Indirme hatasi:", err);
      setDownloading(null);
    }
  };

  const handleDelete = async (modelId: string) => {
    try {
      await deleteModel(modelId);
      loadModels();
    } catch (err) {
      console.error("Silme hatasi:", err);
    }
  };

  const handleSelect = async (modelId: string) => {
    updateSettings({ selectedModel: modelId });
    const current = useSettingsStore.getState().settings;
    try {
      await saveSettings({
        selected_model: modelId,
        selected_device: current.selectedDevice,
        theme: current.theme,
        shortcut: current.shortcut,
        recording_mode: current.recordingMode,
        vad_threshold: current.vadThreshold,
        auto_paste: current.autoPaste,
        language: current.language,
        transcription_engine: current.transcriptionEngine,
        deepgram_api_key: current.deepgramApiKey,
        azure_speech_key: current.azureSpeechKey,
        azure_speech_region: current.azureSpeechRegion,
        google_cloud_api_key: current.googleCloudApiKey,
        voice_activation: current.voiceActivation,
        wake_word: current.wakeWord,
        sound_enabled: current.soundEnabled,
        auto_start: current.autoStart,
        silence_timeout: current.silenceTimeout,
        max_record_duration: current.maxRecordDuration,
        turkish_corrections: current.turkishCorrections,
        hallucination_filter: current.hallucinationFilter,
        overlay_follow_cursor: current.overlayFollowCursor,
        auto_punctuation: current.autoPunctuation,
        auto_capitalization: current.autoCapitalization,
        preserve_english_words: current.preserveEnglishWords,
        auto_comma: current.autoComma,
        paragraph_break: current.paragraphBreak,
        notifications: current.notifications,
        log_level: current.logLevel,
      });
      await emit("settings-changed", current);
    } catch (err) {
      console.error("Ayar kaydetme hatasi:", err);
    }
  };

  const formatSpeed = (bps: number) => {
    if (bps > 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
    if (bps > 1_000) return `${(bps / 1_000).toFixed(0)} KB/s`;
    return `${bps} B/s`;
  };

  const formatSize = (bytes: number) => {
    if (bytes > 1_000_000_000)
      return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
    return `${(bytes / 1_000_000).toFixed(0)} MB`;
  };

  // Modelleri kategorilere ayir
  const maxSize = Math.max(...models.map((m) => m.size_bytes), 1);
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    ...CATEGORY_INFO[cat],
    models: models.filter((m) => getModelMeta(m.id).category === cat),
  })).filter((g) => g.models.length > 0);

  // Aktif model bilgisi
  const activeModel = models.find((m) => m.id === settings.selectedModel);
  const downloadedCount = models.filter((m) => m.downloaded).length;

  return (
    <div className="model-root">
      {/* Baslik */}
      <div className="model-header">
        <div className="model-header-top">
          <div className="model-header-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
            </svg>
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-[rgba(255,255,255,0.8)]">
              Whisper Modelleri
            </h3>
            <p className="text-[10px] text-[rgba(255,255,255,0.2)] mt-0.5">
              Cevrimdisi konusma tanima icin AI model yonetimi
            </p>
          </div>
        </div>

        {/* Aktif model gostergesi */}
        {activeModel && (
          <div className="model-active-badge">
            <div className="model-active-dot" />
            <span className="text-[10px] text-[rgba(250,228,207,0.6)]">
              Aktif: <span className="text-[rgba(250,228,207,0.85)] font-medium">{activeModel.name}</span>
            </span>
            <span className="text-[9px] text-[rgba(255,255,255,0.15)] ml-auto tabular-nums">
              {downloadedCount}/{models.length} indirildi
            </span>
          </div>
        )}
      </div>

      {/* Kategori gruplari */}
      {grouped.map((group) => (
        <div key={group.category} className="model-category">
          {/* Kategori basligi */}
          <div className="model-category-head">
            <div className="model-category-icon">
              <CategoryIcon type={group.icon} />
            </div>
            <span className="text-[10px] font-semibold text-[rgba(250,228,207,0.35)] uppercase tracking-[0.14em]">
              {group.title}
            </span>
            <div className="model-category-line" />
          </div>
          <p className="text-[9px] text-[rgba(255,255,255,0.15)] mb-2.5 ml-[30px]">
            {group.desc}
          </p>

          {/* Model kartlari */}
          <div className="model-card-grid">
            {group.models.map((model) => {
              const meta = getModelMeta(model.id);
              const isActive = settings.selectedModel === model.id;
              const isDownloading = downloading === model.id;

              return (
                <div
                  key={model.id}
                  className={`model-card ${isActive ? "model-card--active" : ""}`}
                >
                  {/* Aktif glow */}
                  {isActive && <div className="model-card-glow" />}

                  {/* Onerilen badge */}
                  {meta.recommended && (
                    <div className="model-recommended">Onerilen</div>
                  )}

                  {/* Aktif badge */}
                  {isActive && (
                    <div className="model-active-chip">
                      <CheckIcon /> Aktif
                    </div>
                  )}

                  {/* Baslik + boyut */}
                  <div className="flex items-start justify-between mb-1">
                    <div>
                      <h4 className={`text-[12px] font-semibold ${
                        isActive ? "text-[#fae4cf]" : "text-[rgba(255,255,255,0.65)]"
                      }`}>
                        {model.name}
                      </h4>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-md tabular-nums ${
                      isActive
                        ? "bg-[rgba(250,228,207,0.12)] text-[rgba(250,228,207,0.65)]"
                        : "bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.2)]"
                    }`}>
                      {model.size_display}
                    </span>
                  </div>

                  {/* Aciklama */}
                  <p className="text-[10px] text-[rgba(255,255,255,0.2)] leading-relaxed mb-3">
                    {model.description}
                  </p>

                  {/* Boyut bar */}
                  <SizeBar sizeBytes={model.size_bytes} maxBytes={maxSize} />

                  {/* Hiz / Kalite gostergesi */}
                  <div className="flex gap-4 mt-2.5 mb-3">
                    <RatingDots value={meta.speed} label="Hiz" />
                    <RatingDots value={meta.quality} label="Kalite" />
                  </div>

                  {/* Indirme progress */}
                  {isDownloading && progress && (
                    <ModelProgress
                      progress={progress}
                      formatSize={formatSize}
                      formatSpeed={formatSpeed}
                    />
                  )}

                  {/* Aksiyonlar */}
                  <div className="model-card-actions">
                    {model.downloaded ? (
                      <>
                        <button
                          onClick={() => handleSelect(model.id)}
                          className={`model-btn ${
                            isActive ? "model-btn--active" : "model-btn--select"
                          }`}
                        >
                          {isActive ? (
                            <><CheckIcon /> Secili</>
                          ) : (
                            "Sec"
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(model.id)}
                          className="model-btn model-btn--delete"
                          title="Modeli sil"
                        >
                          <TrashIcon />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleDownload(model.id)}
                        disabled={downloading !== null}
                        className="model-btn model-btn--download"
                      >
                        {isDownloading ? (
                          <span className="model-btn-spinner" />
                        ) : (
                          <DownloadIcon />
                        )}
                        {isDownloading ? "Indiriliyor..." : "Indir"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Bos durum */}
      {models.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[rgba(250,228,207,0.04)] flex items-center justify-center text-[rgba(255,255,255,0.1)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
          </div>
          <p className="text-[11px] text-[rgba(255,255,255,0.2)]">Model listesi yukleniyor...</p>
        </div>
      )}
    </div>
  );
}
