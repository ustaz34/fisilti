import { useMemo, useState } from "react";
import { useTranscriptionStore, type TranscriptionEntry } from "../stores/transcriptionStore";

/* ═══════════ Helpers (unchanged) ═══════════ */

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}dk ${sec > 0 ? sec + "sn" : ""}`.trim();
  return `${sec}sn`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getDayName(date: Date): string {
  return ["Paz", "Pzt", "Sal", "Car", "Per", "Cum", "Cmt"][date.getDay()];
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function getDayLabel(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  if (ts >= todayStart) return "Bugun";
  if (ts >= yesterdayStart) return "Dun";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/* ═══════════ Micro-components ═══════════ */

function Lbl({ text }: { text: string }) {
  return (
    <div className="st-lbl">
      <span className="st-lbl-text">{text}</span>
      <div className="st-lbl-line" />
    </div>
  );
}

/* ═══════════ Hero Stats ═══════════ */

function HeroStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="st-hero-item">
      <span className={`st-hero-value ${accent ? "st-hero-value--accent" : ""}`}>{value}</span>
      <span className="st-hero-label">{label}</span>
    </div>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="st-mini">
      <span className="st-mini-value">{value}</span>
      <span className="st-mini-label">{label}</span>
    </div>
  );
}

/* ═══════════ Weekly Chart ═══════════ */

function WeeklyChart({ history }: { history: TranscriptionEntry[] }) {
  const weekData = useMemo(() => {
    const now = new Date();
    const days: { label: string; count: number; isToday: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayEnd = dayStart + 86400000;
      const count = history.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd).length;
      days.push({ label: getDayName(d), count, isToday: i === 0 });
    }
    return days;
  }, [history]);

  const maxCount = Math.max(...weekData.map((d) => d.count), 1);
  const totalWeek = weekData.reduce((s, d) => s + d.count, 0);

  return (
    <div className="st-block">
      <div className="flex items-center justify-between mb-4">
        <span className="st-block-label">Son 7 gun</span>
        <span className="st-block-meta">{totalWeek} donusum</span>
      </div>
      <div className="flex items-end gap-[6px] h-[56px]">
        {weekData.map((day, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-[5px]">
            <span className="st-bar-count">{day.count || ""}</span>
            <div
              className="w-full rounded-[3px] transition-all duration-500"
              style={{
                height: `${Math.max((day.count / maxCount) * 40, day.count > 0 ? 3 : 1)}px`,
                background: day.isToday
                  ? "linear-gradient(to top, rgba(250,228,207,0.6), #fae4cf)"
                  : day.count > 0
                    ? "rgba(250,228,207,0.18)"
                    : "rgba(250,228,207,0.04)",
                boxShadow: day.isToday && day.count > 0 ? "0 0 8px rgba(250,228,207,0.15)" : "none",
              }}
            />
            <span className={`text-[8px] ${day.isToday ? "text-[rgba(250,228,207,0.5)] font-medium" : "text-[rgba(255,255,255,0.18)]"}`}>
              {day.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════ Week Comparison ═══════════ */

function WeekComparison({ thisWeek, lastWeek, change }: { thisWeek: number; lastWeek: number; change: number }) {
  if (thisWeek === 0 && lastWeek === 0) return null;
  const isUp = change >= 0;

  return (
    <div className="st-block flex items-center justify-between">
      <div className="flex items-center gap-5">
        <div>
          <div className="st-cmp-value">{thisWeek}</div>
          <div className="st-cmp-label">Bu hafta</div>
        </div>
        <span className="text-[rgba(255,255,255,0.08)] text-[10px]">vs</span>
        <div>
          <div className="st-cmp-value st-cmp-value--muted">{lastWeek}</div>
          <div className="st-cmp-label">Gecen hafta</div>
        </div>
      </div>
      <div className={`st-badge ${isUp ? "st-badge--up" : "st-badge--down"}`}>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: isUp ? "none" : "rotate(180deg)" }}>
          <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
        </svg>
        {isUp ? "+" : ""}{change}%
      </div>
    </div>
  );
}

/* ═══════════ Hourly Activity ═══════════ */

function HourlyActivity({ hourCounts, peakHour }: { hourCounts: number[]; peakHour: number }) {
  const maxCount = Math.max(...hourCounts, 1);
  const hasData = hourCounts.some(c => c > 0);
  if (!hasData) return null;

  return (
    <div className="st-block">
      <div className="flex items-center justify-between mb-3">
        <span className="st-block-label">Saat dagilimi</span>
        <span className="st-block-meta">
          Zirve: <span className="text-[#fae4cf] font-medium">{String(peakHour).padStart(2, "0")}:00</span>
        </span>
      </div>
      <div className="flex items-end gap-px h-10">
        {hourCounts.map((count, hour) => (
          <div key={hour} className="flex-1">
            <div
              className="w-full rounded-[1px] transition-all duration-300"
              style={{
                height: `${Math.max((count / maxCount) * 36, count > 0 ? 2 : 0)}px`,
                background: hour === peakHour
                  ? "#fae4cf"
                  : count > 0
                    ? "rgba(250,228,207,0.18)"
                    : "rgba(250,228,207,0.02)",
                boxShadow: hour === peakHour ? "0 0 6px rgba(250,228,207,0.2)" : "none",
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2 px-0.5">
        {["00", "06", "12", "18", "23"].map(h => (
          <span key={h} className="text-[7px] text-[rgba(255,255,255,0.12)]">{h}</span>
        ))}
      </div>
    </div>
  );
}

/* ═══════════ Engine Bar ═══════════ */

function EngineBar({ history }: { history: TranscriptionEntry[] }) {
  const { webCount, whisperCount, webPercent, whisperPercent } = useMemo(() => {
    const total = history.length;
    if (total === 0) return { webCount: 0, whisperCount: 0, webPercent: 0, whisperPercent: 0 };
    const wc = history.filter((e) => e.engine === "web").length;
    return {
      webCount: wc,
      whisperCount: total - wc,
      webPercent: Math.round((wc / total) * 100),
      whisperPercent: Math.round(((total - wc) / total) * 100),
    };
  }, [history]);

  if (history.length === 0) return null;

  return (
    <div className="st-block">
      <span className="st-block-label mb-3 block">Motor kullanimi</span>
      <div className="w-full h-[6px] bg-[rgba(250,228,207,0.05)] rounded-full overflow-hidden flex">
        {webPercent > 0 && (
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${webPercent}%`, background: "linear-gradient(90deg, rgba(250,228,207,0.6), #fae4cf)" }} />
        )}
      </div>
      <div className="flex justify-between mt-2.5">
        <span className="text-[10px] text-[rgba(255,255,255,0.35)]">
          Web Speech <span className="text-[rgba(255,255,255,0.15)] ml-1">{webCount} (%{webPercent})</span>
        </span>
        <span className="text-[10px] text-[rgba(255,255,255,0.35)]">
          Whisper <span className="text-[rgba(255,255,255,0.15)] ml-1">{whisperCount} (%{whisperPercent})</span>
        </span>
      </div>
    </div>
  );
}

/* ═══════════ Language Distribution ═══════════ */

function LanguageDistribution({ langCounts, total }: { langCounts: Record<string, number>; total: number }) {
  const entries = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);
  if (entries.length <= 1) return null;

  const LANG_NAMES: Record<string, string> = {
    tr: "Turkce", en: "English", de: "Deutsch", fr: "Francais",
    es: "Espanol", it: "Italiano", pt: "Portugues", ru: "Rusca",
    ja: "Japonca", zh: "Cince",
  };

  return (
    <div className="st-block">
      <span className="st-block-label mb-3 block">Dil dagilimi</span>
      {entries.map(([lang, count], i) => {
        const pct = Math.round((count / total) * 100);
        return (
          <div key={lang} className="flex items-center gap-3 mb-2 last:mb-0">
            <span className="text-[10px] text-[rgba(255,255,255,0.35)] w-14 truncate">{LANG_NAMES[lang] || lang}</span>
            <div className="flex-1 h-[5px] bg-[rgba(250,228,207,0.04)] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500" style={{
                width: `${pct}%`,
                background: i === 0 ? "#fae4cf" : `rgba(250,228,207,${Math.max(0.15, 0.45 - i * 0.1)})`,
              }} />
            </div>
            <span className="text-[9px] text-[rgba(255,255,255,0.18)] w-7 text-right tabular-nums">%{pct}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════ Recent History ═══════════ */

function RecentHistory({ history }: { history: TranscriptionEntry[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const editEntry = useTranscriptionStore((s) => s.editEntry);
  const recent = history.slice(0, 15);

  if (recent.length === 0) return null;

  const handleCopy = async (entry: TranscriptionEntry) => {
    if (editingId) return;
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* sessizce devam */ }
  };

  const handleDoubleClick = (entry: TranscriptionEntry) => {
    setEditingId(entry.id);
    setEditText(entry.text);
  };

  const handleEditSave = (id: string) => {
    if (editText.trim()) { editEntry(id, editText.trim()); }
    setEditingId(null);
    setEditText("");
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditText("");
  };

  let lastDay = "";

  return (
    <div>
      {recent.map((entry) => {
        const dayLabel = getDayLabel(entry.timestamp);
        const showDaySep = dayLabel !== lastDay;
        lastDay = dayLabel;

        return (
          <div key={entry.id}>
            {showDaySep && (
              <div className="pt-3 pb-1 px-1">
                <span className="text-[8px] text-[rgba(250,228,207,0.25)] font-semibold tracking-[0.15em] uppercase">{dayLabel}</span>
              </div>
            )}
            <div
              onClick={() => handleCopy(entry)}
              onDoubleClick={() => handleDoubleClick(entry)}
              className="st-history-row group"
            >
              <div className={`st-history-dot ${entry.engine === "web" ? "st-history-dot--web" : ""}`} />

              <div className="flex-1 min-w-0">
                {editingId === entry.id ? (
                  <input
                    type="text" value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleEditSave(entry.id); if (e.key === "Escape") handleEditCancel(); }}
                    onBlur={() => handleEditSave(entry.id)}
                    autoFocus onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
                    className="w-full text-[11px] text-[rgba(255,255,255,0.85)] bg-[rgba(250,228,207,0.06)] border border-[rgba(250,228,207,0.2)] rounded-md px-2.5 py-1.5 outline-none focus:border-[rgba(250,228,207,0.4)]"
                    style={{ userSelect: "text", WebkitUserSelect: "text" }}
                  />
                ) : (
                  <>
                    <p className="text-[11px] text-[rgba(255,255,255,0.5)] leading-relaxed truncate">{entry.text}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="st-history-meta">{formatTime(entry.timestamp)}</span>
                      <span className="st-history-meta">{formatDuration(entry.durationMs)}</span>
                      <span className="st-history-meta text-[rgba(250,228,207,0.18)]">{countWords(entry.text)} kelime</span>
                      {entry.userEdited && <span className="st-history-tag">duzenlendi</span>}
                      {entry.confidence !== undefined && entry.confidence < 0.7 && (
                        <span className="st-history-tag st-history-tag--warn">dusuk guven</span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {editingId !== entry.id && (
                <span className={`text-[8px] flex-shrink-0 mt-0.5 transition-opacity duration-150 ${
                  copiedId === entry.id ? "text-[#fae4cf] opacity-100" : "text-[rgba(255,255,255,0.1)] opacity-0 group-hover:opacity-100"
                }`}>
                  {copiedId === entry.id ? "Kopyalandi" : "Kopyala"}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════ Clear History ═══════════ */

function ClearHistoryButton() {
  const [confirming, setConfirming] = useState(false);
  const clearHistory = useTranscriptionStore((s) => s.clearHistory);
  const historyLength = useTranscriptionStore((s) => s.history.length);

  if (historyLength === 0) return null;

  const handleClear = () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    clearHistory();
    setConfirming(false);
  };

  return (
    <div className="flex justify-center pt-6 pb-2">
      <button
        onClick={handleClear}
        className={`px-4 py-1.5 rounded-lg text-[10px] transition-all duration-200 ${
          confirming
            ? "bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.2)] text-[rgba(248,113,113,0.6)]"
            : "text-[rgba(255,255,255,0.15)] hover:text-[rgba(255,255,255,0.3)]"
        }`}
      >
        {confirming ? "Emin misiniz? Tekrar tiklayin" : "Gecmisi temizle"}
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════
   Ana Panel
   ═══════════════════════════════════════ */

export function StatsPanel() {
  const history = useTranscriptionStore((s) => s.history);

  const stats = useMemo(() => {
    const totalCount = history.length;
    const totalDurationMs = history.reduce((sum, e) => sum + e.durationMs, 0);
    const totalWords = history.reduce((sum, e) => sum + countWords(e.text), 0);
    const totalMinutes = totalDurationMs / 60000;
    const wpm = totalMinutes > 0 ? Math.round(totalWords / totalMinutes) : 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = history.filter((e) => e.timestamp >= todayStart.getTime()).length;

    const daySet = new Set<string>();
    history.forEach((e) => {
      const d = new Date(e.timestamp);
      daySet.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    });
    let streak = 0;
    const now = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (daySet.has(key)) { streak++; } else { if (i === 0) continue; break; }
    }

    const avgDurationMs = totalCount > 0 ? totalDurationMs / totalCount : 0;
    const avgWordsPerEntry = totalCount > 0 ? Math.round(totalWords / totalCount) : 0;
    const longestDurationMs = history.length > 0 ? Math.max(...history.map(e => e.durationMs)) : 0;

    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(thisWeekStart.getDate() - dayOfWeek + 1);
    thisWeekStart.setHours(0, 0, 0, 0);
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const thisWeekCount = history.filter(e => e.timestamp >= thisWeekStart.getTime()).length;
    const lastWeekCount = history.filter(e => e.timestamp >= lastWeekStart.getTime() && e.timestamp < thisWeekStart.getTime()).length;
    const weekChange = lastWeekCount > 0 ? Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100) : (thisWeekCount > 0 ? 100 : 0);

    const langCounts: Record<string, number> = {};
    history.forEach(e => { langCounts[e.language] = (langCounts[e.language] || 0) + 1; });

    const hourCounts = new Array(24).fill(0);
    history.forEach(e => { hourCounts[new Date(e.timestamp).getHours()]++; });
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

    return { totalCount, totalDurationMs, totalWords, wpm, todayCount, streak, avgDurationMs, avgWordsPerEntry, longestDurationMs, thisWeekCount, lastWeekCount, weekChange, langCounts, hourCounts, peakHour };
  }, [history]);

  /* Bos durum */
  if (history.length === 0) {
    return (
      <div className="st-root">
        <div className="st-empty">
          <div className="st-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
          <p className="text-[12px] text-[rgba(255,255,255,0.3)] mt-4">Henuz donusum yapilmadi</p>
          <p className="text-[10px] text-[rgba(255,255,255,0.15)] mt-1.5 text-center max-w-[200px] leading-relaxed">
            Ilk kaydinizi yapin, istatistikler burada gorunecek
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="st-root">

      {/* ── Hero Stats ── */}
      <div className="st-hero">
        <HeroStat value={stats.totalCount.toString()} label="Donusum" />
        <div className="st-hero-sep" />
        <HeroStat value={stats.totalWords.toLocaleString("tr-TR")} label="Kelime" />
        <div className="st-hero-sep" />
        <HeroStat value={stats.todayCount.toString()} label="Bugun" accent />
      </div>

      {/* ── Detail Stats ── */}
      <div className="st-mini-grid">
        <MiniStat value={formatDuration(stats.totalDurationMs)} label="Toplam Sure" />
        <MiniStat value={`${stats.wpm}`} label="Kelime/dk" />
        <MiniStat value={`${stats.streak} gun`} label="Seri" />
        <MiniStat value={formatDuration(stats.avgDurationMs)} label="Ort. Sure" />
        <MiniStat value={stats.avgWordsPerEntry.toString()} label="Ort. Kelime" />
        <MiniStat value={formatDuration(stats.longestDurationMs)} label="En Uzun" />
      </div>

      {/* ── Haftalik ── */}
      <Lbl text="Haftalik" />
      <WeeklyChart history={history} />
      <div className="h-2" />
      <WeekComparison thisWeek={stats.thisWeekCount} lastWeek={stats.lastWeekCount} change={stats.weekChange} />

      {/* ── Aktivite ── */}
      <Lbl text="Aktivite" />
      <HourlyActivity hourCounts={stats.hourCounts} peakHour={stats.peakHour} />

      {/* ── Dagilim ── */}
      <Lbl text="Dagilim" />
      <EngineBar history={history} />
      <div className="h-2" />
      <LanguageDistribution langCounts={stats.langCounts} total={stats.totalCount} />

      {/* ── Gecmis ── */}
      <Lbl text="Son Donusumler" />
      <RecentHistory history={history} />
      <ClearHistoryButton />
    </div>
  );
}
