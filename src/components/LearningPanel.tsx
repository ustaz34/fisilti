import { useEffect, useState, useMemo } from "react";
import {
  getUserCorrections,
  getUserProfile,
  getDynamicPromptPreview,
  getNgramStats,
  getDomainInfo,
  addUserCorrection,
  removeUserCorrection,
  resetLearningData,
  exportCorrections,
  importCorrections,
  type UserCorrection,
  type UserProfile,
  type DynamicPromptPreview,
  type NgramEntry,
  type DomainInfo,
} from "../lib/tauri-commands";
import { useSettingsStore } from "../stores/settingsStore";

/* ═══════════ Section Label ═══════════ */

function Lbl({ text }: { text: string }) {
  return (
    <div className="st-lbl">
      <span className="st-lbl-text">{text}</span>
      <div className="st-lbl-line" />
    </div>
  );
}

/* ═══════════ Metric Strip ═══════════ */

function MetricStrip({ corrections, profile }: { corrections: UserCorrection[]; profile: UserProfile }) {
  const rate = profile.total_transcriptions > 0
    ? ((profile.total_corrections / profile.total_transcriptions) * 100).toFixed(1)
    : "0";
  const domainName: Record<string, string> = { General: "Genel", Technical: "Teknik", Medical: "Tibbi", Legal: "Hukuki", Business: "Is" };

  const metrics = [
    { value: corrections.length, label: "Sozluk", accent: true },
    { value: domainName[profile.domain] || profile.domain, label: "Alan" },
    { value: profile.total_transcriptions, label: "Donusum" },
    { value: `%${rate}`, label: "Oran", accent: true },
  ];

  return (
    <div className="lrn-strip">
      {metrics.map((m, i) => (
        <div key={i} className="lrn-strip-item">
          <span className={`lrn-strip-value ${m.accent ? "lrn-strip-value--accent" : ""}`}>{m.value}</span>
          <span className="lrn-strip-label">{m.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════ Prompt Preview ═══════════ */

function PromptPreview({ preview }: { preview: DynamicPromptPreview | null }) {
  if (!preview) return (
    <div className="lrn-empty">Prompt verisi yukleniyor...</div>
  );

  const pct = Math.min((preview.total_length / preview.max_length) * 100, 100);

  return (
    <div className="lrn-prompt">
      {/* Katmanlar */}
      <div className="lrn-prompt-layers">
        <div className="lrn-prompt-layer">
          <span className="lrn-prompt-tag">Temel</span>
          <span className="lrn-prompt-text">{preview.base_prompt}</span>
        </div>

        {preview.domain_addition && (
          <div className="lrn-prompt-layer">
            <span className="lrn-prompt-tag lrn-prompt-tag--domain">Alan</span>
            <span className="lrn-prompt-text lrn-prompt-text--domain">{preview.domain_addition}</span>
          </div>
        )}

        {preview.user_terms && (
          <div className="lrn-prompt-layer">
            <span className="lrn-prompt-tag lrn-prompt-tag--user">Kullanici</span>
            <span className="lrn-prompt-text lrn-prompt-text--accent">{preview.user_terms}</span>
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="lrn-prompt-bar">
        <div className="lrn-prompt-bar-track">
          <div className="lrn-prompt-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="lrn-prompt-bar-label">{preview.total_length} / {preview.max_length}</span>
      </div>
    </div>
  );
}

/* ═══════════ Frequent Words ═══════════ */

function FrequentWords({ words }: { words: string[] }) {
  const wordCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const w of words) { counts[w] = (counts[w] || 0) + 1; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [words]);

  if (wordCounts.length === 0) return (
    <div className="lrn-empty">Henuz yeterli veri yok. Daha fazla donusum yaptikca sik kelimeler burada gorunecek.</div>
  );

  const maxCount = wordCounts[0]?.[1] || 1;

  return (
    <div className="lrn-words">
      {wordCounts.map(([word, count]) => (
        <div key={word} className="lrn-word-row">
          <span className="lrn-word-label">{word}</span>
          <div className="lrn-word-bar-wrap">
            <div className="lrn-word-bar" style={{ width: `${(count / maxCount) * 100}%` }} />
          </div>
          <span className="lrn-word-count">{count}</span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════ N-gram Stats ═══════════ */

function NgramStats({ ngrams }: { ngrams: NgramEntry[] }) {
  const bigrams = useMemo(() =>
    ngrams.filter(n => n.ngram.split(" ").length === 2).slice(0, 10),
  [ngrams]);
  const trigrams = useMemo(() =>
    ngrams.filter(n => n.ngram.split(" ").length === 3).slice(0, 10),
  [ngrams]);

  if (bigrams.length === 0 && trigrams.length === 0) return (
    <div className="lrn-empty">N-gram verisi henuz olusmadi. Donusumlerin artmasiyla burada kelime kaliplari gorunecek.</div>
  );

  return (
    <div className="lrn-ngrams">
      {bigrams.length > 0 && (
        <div className="mb-3">
          <span className="lrn-ngram-title">2-gram</span>
          <div className="lrn-ngram-pills">
            {bigrams.map(n => (
              <span key={n.ngram} className="lrn-pill">
                {n.ngram}
                <span className="lrn-pill-count">{n.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {trigrams.length > 0 && (
        <div>
          <span className="lrn-ngram-title">3-gram</span>
          <div className="lrn-ngram-pills">
            {trigrams.map(n => (
              <span key={n.ngram} className="lrn-pill">
                {n.ngram}
                <span className="lrn-pill-count">{n.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════ Domain Detection ═══════════ */

function DomainDetection({ domainInfo }: { domainInfo: DomainInfo | null }) {
  if (!domainInfo) return null;

  const scores = Object.entries(domainInfo.scores);

  return (
    <div className="lrn-domain">
      <div className="lrn-domain-top">
        <span className="lrn-domain-badge">{domainInfo.detected}</span>
        <span className="lrn-domain-desc">{domainInfo.explanation}</span>
      </div>

      {scores.length > 0 && (
        <div className="lrn-domain-bars">
          {scores.map(([name, score]) => (
            <div key={name} className="lrn-domain-bar-row">
              <span className="lrn-domain-bar-label">{name}</span>
              <div className="lrn-domain-bar-track">
                <div className="lrn-domain-bar-fill" style={{ width: `${Math.min(score * 10, 100)}%` }} />
              </div>
              <span className="lrn-domain-bar-value">{score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════ Correction Dictionary ═══════════ */

function CorrectionDictionary({ corrections, onRefresh }: {
  corrections: UserCorrection[]; onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [newWrong, setNewWrong] = useState("");
  const [newRight, setNewRight] = useState("");

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return corrections
      .filter(c => !s || c.wrong.includes(s) || c.right.includes(s))
      .sort((a, b) => b.count - a.count);
  }, [corrections, search]);

  const [addError, setAddError] = useState("");

  const handleAdd = async () => {
    if (!newWrong.trim() || !newRight.trim()) return;
    if (newWrong.trim().toLowerCase() === newRight.trim().toLowerCase()) {
      setAddError("Yanlis ve dogru kelime ayni olamaz");
      setTimeout(() => setAddError(""), 3000);
      return;
    }
    try {
      setAddError("");
      await addUserCorrection(newWrong.trim(), newRight.trim());
      setNewWrong("");
      setNewRight("");
      onRefresh();
    } catch (e: any) {
      setAddError(e?.toString() || "Duzeltme eklenemedi");
      setTimeout(() => setAddError(""), 3000);
    }
  };

  const handleRemove = async (wrong: string) => {
    try {
      await removeUserCorrection(wrong);
      onRefresh();
    } catch (e) { console.error("Duzeltme silinemedi:", e); }
  };

  return (
    <div className="lrn-dict">
      {/* Arama + Ekleme */}
      <div className="lrn-dict-controls">
        <input
          type="text" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Ara..."
          className="lrn-dict-search"
        />
        <div className="lrn-dict-add">
          <input type="text" value={newWrong} onChange={e => setNewWrong(e.target.value)}
            placeholder="Yanlis" className="lrn-dict-input" />
          <span className="lrn-dict-arrow">→</span>
          <input type="text" value={newRight} onChange={e => setNewRight(e.target.value)}
            placeholder="Dogru" className="lrn-dict-input"
            onKeyDown={e => { if (e.key === "Enter") handleAdd(); }} />
          <button onClick={handleAdd} className="lrn-dict-add-btn">+</button>
        </div>
        {addError && <div className="lrn-dict-error">{addError}</div>}
      </div>
      <div className="lrn-dict-hint">Pipeline duzeltmelerini otomatik ogrenir. Gecmis sekmesinden duzenleme yapinca da ogrenilir.</div>

      {/* Tablo */}
      {filtered.length > 0 ? (
        <div className="lrn-dict-table">
          {filtered.map(c => (
            <div key={c.wrong} className="lrn-dict-row group">
              <span className="lrn-dict-wrong">{c.wrong}</span>
              <span className="lrn-dict-arrow-sm">→</span>
              <span className="lrn-dict-right">{c.right}</span>
              <span className="lrn-dict-count">{c.count}x</span>
              <button onClick={() => handleRemove(c.wrong)} className="lrn-dict-del">
                <svg width="8" height="8" viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="lrn-empty">
          {corrections.length === 0
            ? "Henuz duzeltme yok. Donusumleri duzenledikce sistem otomatik ogrenecek."
            : "Arama kriterine uyan duzeltme bulunamadi."}
        </div>
      )}
    </div>
  );
}

/* ═══════════ Actions ═══════════ */

function LearningActions({ onRefresh }: { onRefresh: () => void }) {
  const [confirming, setConfirming] = useState(false);

  const handleReset = async () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    try {
      await resetLearningData();
      onRefresh();
      setConfirming(false);
    } catch (e) { console.error("Sifirlama hatasi:", e); }
  };

  const handleExport = async () => {
    try {
      const json = await exportCorrections();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fisilti-corrections-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error("Disa aktarma hatasi:", e); }
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        await importCorrections(text);
        onRefresh();
      } catch (err) { console.error("Ice aktarma hatasi:", err); }
    };
    input.click();
  };

  return (
    <div className="lrn-actions">
      <button onClick={handleReset} className={`lrn-action-btn ${confirming ? "lrn-action-btn--danger" : ""}`}>
        {confirming ? "Emin misiniz?" : "Sifirla"}
      </button>
      <button onClick={handleExport} className="lrn-action-btn">Disa Aktar</button>
      <button onClick={handleImport} className="lrn-action-btn">Ice Aktar</button>
    </div>
  );
}

/* ═══════════════════════════════════════
   Main LearningPanel
   ═══════════════════════════════════════ */

export function LearningPanel() {
  const { settings } = useSettingsStore();
  const [corrections, setCorrections] = useState<UserCorrection[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [promptPreview, setPromptPreview] = useState<DynamicPromptPreview | null>(null);
  const [ngrams, setNgrams] = useState<NgramEntry[]>([]);
  const [domainInfo, setDomainInfo] = useState<DomainInfo | null>(null);

  const loadAll = () => {
    getUserCorrections().then(setCorrections).catch(console.error);
    getUserProfile().then(setProfile).catch(console.error);
    getDynamicPromptPreview(settings.language).then(setPromptPreview).catch(console.error);
    getNgramStats().then(setNgrams).catch(console.error);
    getDomainInfo().then(setDomainInfo).catch(console.error);
  };

  useEffect(() => { loadAll(); }, []);

  return (
    <div className="lrn-root">
      {/* Metrik Seridi */}
      {profile && <MetricStrip corrections={corrections} profile={profile} />}

      {/* Dinamik Prompt */}
      <Lbl text="Dinamik Prompt" />
      <PromptPreview preview={promptPreview} />

      {/* Sik Kelimeler */}
      {profile && (
        <>
          <Lbl text="Sik Kelimeler" />
          <FrequentWords words={profile.frequent_words} />
        </>
      )}

      {/* N-gram Kaliplari */}
      <Lbl text="N-gram Kaliplari" />
      <NgramStats ngrams={ngrams} />

      {/* Alan Tespiti */}
      <Lbl text="Alan Tespiti" />
      <DomainDetection domainInfo={domainInfo} />

      {/* Duzeltme Sozlugu */}
      <Lbl text="Duzeltme Sozlugu" />
      <CorrectionDictionary corrections={corrections} onRefresh={loadAll} />

      {/* Aksiyonlar */}
      <LearningActions onRefresh={loadAll} />
    </div>
  );
}
