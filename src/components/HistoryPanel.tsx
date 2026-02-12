import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranscriptionStore, type TranscriptionEntry } from "../stores/transcriptionStore";

/* ═══════════ HistoryPanel ═══════════ */

type EngineFilter = "all" | "web" | "whisper" | "deepgram" | "azure" | "google-cloud";

export function HistoryPanel() {
  const { history, loadHistory, editEntry, clearHistory } = useTranscriptionStore();
  const [search, setSearch] = useState("");
  const [engineFilter, setEngineFilter] = useState<EngineFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  const filtered = useMemo(() => {
    let items = history;
    if (engineFilter !== "all") {
      items = items.filter((e) => e.engine === engineFilter);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      items = items.filter((e) => e.text.toLowerCase().includes(s));
    }
    return items;
  }, [history, search, engineFilter]);

  // Gun ayiraclari icin gruplama
  const grouped = useMemo(() => {
    const groups: { date: string; entries: TranscriptionEntry[] }[] = [];
    let currentDate = "";
    for (const entry of filtered) {
      const d = new Date(entry.timestamp);
      const dateStr = d.toLocaleDateString("tr-TR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      if (dateStr !== currentDate) {
        currentDate = dateStr;
        groups.push({ date: dateStr, entries: [] });
      }
      groups[groups.length - 1].entries.push(entry);
    }
    return groups;
  }, [filtered]);

  const handleDoubleClick = useCallback((entry: TranscriptionEntry) => {
    setEditingId(entry.id);
    setEditText(entry.text);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingId && editText.trim()) {
      editEntry(editingId, editText.trim());
    }
    setEditingId(null);
    setEditText("");
  }, [editingId, editText, editEntry]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText("");
  }, []);

  const handleCopy = useCallback(async (entry: TranscriptionEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // clipboard hatasi
    }
  }, []);

  const handleClear = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    clearHistory();
    setConfirmClear(false);
  }, [confirmClear, clearHistory]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatDuration = (ms: number) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}dk ${s % 60}s`;
  };

  return (
    <div className="lrn-root">
      {/* Kontroller */}
      <div className="lrn-dict-controls">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Gecmiste ara..."
          className="lrn-dict-search"
        />
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {(["all", "web", "whisper", "deepgram", "azure", "google-cloud"] as EngineFilter[]).map((f) => {
            const labels: Record<string, string> = {
              all: "Tumu", web: "Web", whisper: "Whisper",
              deepgram: "Deepgram", azure: "Azure", "google-cloud": "G.Cloud",
            };
            return (
              <button
                key={f}
                onClick={() => setEngineFilter(f)}
                className={`lrn-action-btn ${engineFilter === f ? "lrn-action-btn--active" : ""}`}
                style={{ padding: "3px 10px", fontSize: 9 }}
              >
                {labels[f]}
              </button>
            );
          })}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
            {filtered.length} kayit
          </span>
        </div>
      </div>

      {/* Gecmis Listesi */}
      {grouped.length === 0 ? (
        <div className="lrn-empty">
          {history.length === 0
            ? "Henuz gecmis kaydi yok. Donusum yaptikca burada gorunecek."
            : "Arama/filtre kriterine uyan kayit bulunamadi."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {grouped.map((group) => (
            <div key={group.date}>
              {/* Gun ayiraci */}
              <div className="st-lbl" style={{ padding: "10px 0 2px" }}>
                <span className="st-lbl-text">{group.date}</span>
                <div className="st-lbl-line" />
              </div>

              {group.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="st-history-row"
                  onDoubleClick={() => handleDoubleClick(entry)}
                >
                  {/* Motor noktasi */}
                  <div
                    className={`st-history-dot ${
                      entry.engine === "web" ? "st-history-dot--web" : ""
                    }`}
                  />

                  {/* Icerik */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editingId === entry.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="lrn-dict-search"
                          style={{
                            minHeight: 60,
                            resize: "vertical",
                            fontFamily: "inherit",
                          }}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSaveEdit();
                            }
                            if (e.key === "Escape") handleCancelEdit();
                          }}
                        />
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={handleSaveEdit}
                            className="lrn-action-btn lrn-action-btn--active"
                            style={{ padding: "2px 10px", fontSize: 9 }}
                          >
                            Kaydet
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="lrn-action-btn"
                            style={{ padding: "2px 10px", fontSize: 9 }}
                          >
                            Iptal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.55)",
                          lineHeight: 1.5,
                          wordBreak: "break-word",
                          cursor: "text",
                          userSelect: "text",
                          WebkitUserSelect: "text",
                        }}
                      >
                        {entry.text}
                      </div>
                    )}

                    {/* Meta bilgiler */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 3,
                      }}
                    >
                      <span className="st-history-meta">{formatTime(entry.timestamp)}</span>
                      <span className="st-history-meta">{formatDuration(entry.durationMs)}</span>
                      <span className="st-history-tag">
                        {entry.engine === "web" ? "Web" : "Whisper"}
                      </span>
                      {entry.userEdited && (
                        <span className="st-history-tag st-history-tag--warn">
                          Duzenlendi
                        </span>
                      )}
                      {entry.confidence !== undefined && (
                        <span className="st-history-meta">
                          %{Math.round(entry.confidence * 100)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Kopyala butonu */}
                  {editingId !== entry.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(entry);
                      }}
                      className="lrn-dict-del"
                      style={{ opacity: 1, color: copiedId === entry.id ? "rgba(134,239,172,0.6)" : undefined }}
                      title="Kopyala"
                    >
                      {copiedId === entry.id ? (
                        <svg width="10" height="10" viewBox="0 0 10 10">
                          <polyline points="2,5 4,7 8,3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 10 10">
                          <rect x="3" y="3" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
                          <rect x="1" y="1" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Alt aksiyonlar */}
      {history.length > 0 && (
        <div className="lrn-actions">
          <button
            onClick={handleClear}
            className={`lrn-action-btn ${confirmClear ? "lrn-action-btn--danger" : ""}`}
          >
            {confirmClear ? "Emin misiniz?" : "Gecmisi Temizle"}
          </button>
        </div>
      )}
    </div>
  );
}
