// P2P Isbirligi Paneli — oturum baslat/baglan, QR kod, canli transkripsiyon
import React, { useState, useRef, useEffect } from "react";
import QRCode from "react-qr-code";
import { useCollabStore } from "../stores/collabStore";
import { peerService } from "../lib/peerService";
import { useSettingsStore } from "../stores/settingsStore";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

// GitHub Pages uzerinden uzak erisim icin temel URL
const REMOTE_PAGE_URL = "https://ustaz34.github.io/fisilti/";

/* ════════════════════════════════════════
   Micro-components (SettingsPanel paterni)
   ════════════════════════════════════════ */

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="sp-section">
      <div className="sp-section-head">
        <div className="sp-section-icon">{icon}</div>
        <h2 className="sp-section-title">{title}</h2>
        <div className="sp-section-line" />
      </div>
      <div className="sp-section-body">{children}</div>
    </div>
  );
}

/* ════════════════════════════════════════
   Icons
   ════════════════════════════════════════ */

const icons = {
  link: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  ),
  users: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  text: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
};

/* ════════════════════════════════════════
   CollabPanel
   ════════════════════════════════════════ */

export function CollabPanel() {
  const features = useSettingsStore((s) => s.settings.features);
  const { isHosting, sessionId, peers, sharedTranscript, startSession, stopSession, connectToPeer, serverUrl, isServerStarting } =
    useCollabStore();

  const [connectId, setConnectId] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Transkripsiyon degistiginde otomatik asagi kaydir
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [sharedTranscript]);

  // Oturum baslat
  const handleStart = async () => {
    setError(null);
    try {
      await startSession();
    } catch (e) {
      setError("Oturum baslatma hatasi: " + String(e));
    }
  };

  // Peer'a baglan
  const handleConnect = async () => {
    if (!connectId.trim()) return;
    setError(null);
    setIsConnecting(true);
    try {
      await connectToPeer(connectId.trim());
    } catch (e) {
      setError("Baglanti hatasi: " + String(e));
    } finally {
      setIsConnecting(false);
    }
  };

  // Uzak erisim URL'si (GitHub Pages uzerinden, farkli ag icin)
  const remoteUrl = sessionId ? REMOTE_PAGE_URL + "?peer=" + sessionId : "";

  // Yerel URL kopyala
  const handleCopyLocal = () => {
    if (serverUrl) {
      writeText(serverUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Uzak URL kopyala
  const [copiedRemote, setCopiedRemote] = useState(false);
  const handleCopyRemote = () => {
    if (remoteUrl) {
      writeText(remoteUrl);
      setCopiedRemote(true);
      setTimeout(() => setCopiedRemote(false), 2000);
    }
  };

  // QR modunu sec: yerel veya uzak
  const [qrMode, setQrMode] = useState<"local" | "remote">("local");
  const qrValue = qrMode === "local" ? (serverUrl || sessionId || "") : remoteUrl;

  if (!features.collaboration) {
    return (
      <div className="sp-section">
        <div className="sp-section-head">
          <div className="sp-section-icon">{icons.link}</div>
          <h2 className="sp-section-title">Isbirligi</h2>
          <div className="sp-section-line" />
        </div>
        <div className="sp-section-body">
          <p className="text-[11px] text-[rgba(255,255,255,0.35)]">
            Bu ozellik devre disi. Eklentiler sekmesinden aktif edebilirsiniz.
          </p>
        </div>
      </div>
    );
  }

  const peerCount = peers.length;

  return (
    <>
      {/* ── Baglanti Yonetimi ── */}
      <Section title="Oturum" icon={icons.link}>
        {!sessionId ? (
          <div className="flex flex-col gap-3">
            {/* Oturum Baslat */}
            <button
              onClick={handleStart}
              className="w-full h-9 rounded-xl text-[11px] font-semibold tracking-wide
                         bg-[rgba(var(--accent-rgb),0.12)] text-[var(--color-accent)]
                         hover:bg-[rgba(var(--accent-rgb),0.2)] transition-colors duration-200"
            >
              Oturum Baslat
            </button>

            {/* Ayirici */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[rgba(var(--accent-rgb),0.06)]" />
              <span className="text-[9px] text-[rgba(255,255,255,0.2)]">veya</span>
              <div className="flex-1 h-px bg-[rgba(var(--accent-rgb),0.06)]" />
            </div>

            {/* Manuel Baglanti */}
            <div className="flex gap-2">
              <input
                type="text"
                value={connectId}
                onChange={(e) => setConnectId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                placeholder="Peer ID girin..."
                className="flex-1 h-8 px-3 rounded-lg text-[11px] bg-[rgba(var(--accent-rgb),0.04)]
                           border border-[rgba(var(--accent-rgb),0.08)] text-[rgba(255,255,255,0.7)]
                           placeholder:text-[rgba(255,255,255,0.15)] outline-none
                           focus:border-[rgba(var(--accent-rgb),0.2)] transition-colors"
              />
              <button
                onClick={handleConnect}
                disabled={!connectId.trim() || isConnecting}
                className="h-8 px-4 rounded-lg text-[10px] font-semibold
                           bg-[rgba(var(--accent-rgb),0.08)] text-[rgba(var(--accent-rgb),0.7)]
                           hover:bg-[rgba(var(--accent-rgb),0.15)] transition-colors
                           disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isConnecting ? "..." : "Baglan"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Durum gostergesi */}
            <div className="flex items-center gap-2">
              {isServerStarting ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] text-[rgba(255,255,255,0.3)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Sunucu baslatiliyor...
                </span>
              ) : isHosting ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] text-[rgba(var(--accent-rgb),0.5)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
                  Oturum aktif
                </span>
              ) : null}
            </div>

            {/* QR Mod Secici: Yerel / Uzak */}
            <div className="flex rounded-lg overflow-hidden border border-[rgba(var(--accent-rgb),0.08)]">
              <button
                onClick={() => setQrMode("local")}
                className={"flex-1 h-7 text-[10px] font-semibold transition-colors " +
                  (qrMode === "local"
                    ? "bg-[rgba(var(--accent-rgb),0.12)] text-[var(--color-accent)]"
                    : "bg-transparent text-[rgba(255,255,255,0.25)] hover:text-[rgba(255,255,255,0.4)]")}
              >
                Ayni Ag (Wi-Fi)
              </button>
              <button
                onClick={() => setQrMode("remote")}
                className={"flex-1 h-7 text-[10px] font-semibold transition-colors " +
                  (qrMode === "remote"
                    ? "bg-[rgba(var(--accent-rgb),0.12)] text-[var(--color-accent)]"
                    : "bg-transparent text-[rgba(255,255,255,0.25)] hover:text-[rgba(255,255,255,0.4)]")}
              >
                Farkli Ag (Internet)
              </button>
            </div>

            {/* Paylasim URL'si */}
            <div className="flex flex-col gap-2">
              <div className="text-[9px] text-[rgba(255,255,255,0.25)] uppercase tracking-wider">
                {qrMode === "local" ? "Yerel Erisim URL" : "Uzak Erisim URL"}
              </div>
              <div
                onClick={qrMode === "local" ? handleCopyLocal : handleCopyRemote}
                className="px-3 py-2.5 rounded-lg bg-[rgba(var(--accent-rgb),0.04)]
                           border border-[rgba(var(--accent-rgb),0.08)] cursor-pointer
                           hover:bg-[rgba(var(--accent-rgb),0.08)] transition-colors"
              >
                <span className="text-[10px] text-[rgba(var(--accent-rgb),0.6)] font-mono break-all">
                  {qrMode === "local" ? (serverUrl || "Sunucu baslatiliyor...") : remoteUrl}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-[rgba(255,255,255,0.2)]">
                  {(qrMode === "local" ? copied : copiedRemote) ? "Kopyalandi!" : "Tiklayarak kopyala"}
                </span>
                <span className="text-[9px] text-[rgba(255,255,255,0.15)]">
                  {qrMode === "local" ? "Ayni Wi-Fi aginda olmali" : "Her yerden erisim"}
                </span>
              </div>
            </div>

            {/* QR Kod */}
            {qrValue && (
              <div className="flex flex-col items-center gap-2 py-2">
                <div className="p-3 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(var(--accent-rgb),0.06)]">
                  <QRCode
                    value={qrValue}
                    size={140}
                    bgColor="transparent"
                    fgColor="rgba(255,255,255,0.7)"
                    level="M"
                  />
                </div>
                <span className="text-[9px] text-[rgba(255,255,255,0.2)]">
                  {qrMode === "local"
                    ? "Telefonunuzun kamerasini QR koda tutun"
                    : "Bu linki WhatsApp, Telegram vb. ile de paylasabilirsiniz"}
                </span>
              </div>
            )}

            {/* Baglanti Kes */}
            <button
              onClick={stopSession}
              className="w-full h-8 rounded-xl text-[10px] font-semibold
                         bg-[rgba(255,80,80,0.08)] text-[rgba(255,80,80,0.7)]
                         hover:bg-[rgba(255,80,80,0.15)] transition-colors duration-200"
            >
              Oturumu Sonlandir
            </button>
          </div>
        )}

        {/* Hata mesaji */}
        {error && (
          <div className="mt-2 px-3 py-2 rounded-lg bg-[rgba(255,80,80,0.06)] border border-[rgba(255,80,80,0.1)]">
            <span className="text-[10px] text-[rgba(255,80,80,0.7)]">{error}</span>
          </div>
        )}
      </Section>

      {/* ── Bagli Peer'lar ── */}
      {sessionId && (
        <Section title={"Baglantilar (" + peerCount + ")"} icon={icons.users}>
          {peerCount === 0 ? (
            <div className="text-center py-4">
              <span className="text-[10px] text-[rgba(255,255,255,0.2)]">
                Henuz bagli peer yok. QR kodu paylasin veya ID gonderin.
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {peers.map((peer) => (
                <div
                  key={peer.id}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg
                             bg-[rgba(var(--accent-rgb),0.03)] border border-[rgba(var(--accent-rgb),0.05)]"
                >
                  <span
                    className={
                      "w-2 h-2 rounded-full flex-shrink-0 " +
                      (peer.isConnected
                        ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]"
                        : "bg-[rgba(255,255,255,0.15)]")
                    }
                  />
                  <span className="flex-1 text-[11px] text-[rgba(255,255,255,0.6)] truncate">
                    {peer.name}
                  </span>
                  <span className="text-[9px] text-[rgba(255,255,255,0.15)] font-mono">
                    {peer.id.slice(0, 10)}...
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Canli Transkripsiyon ── */}
      {sessionId && (
        <Section title="Canli Transkripsiyon" icon={icons.text}>
          <div
            ref={transcriptRef}
            className="min-h-[80px] max-h-[200px] overflow-y-auto scrollbar-thin
                       px-3 py-2.5 rounded-xl bg-[rgba(var(--accent-rgb),0.02)]
                       border border-[rgba(var(--accent-rgb),0.06)]"
          >
            {sharedTranscript ? (
              <p className="text-[11px] text-[rgba(255,255,255,0.55)] leading-relaxed whitespace-pre-wrap">
                {sharedTranscript}
              </p>
            ) : (
              <p className="text-[10px] text-[rgba(255,255,255,0.15)] text-center italic">
                Henuz metin yok. Konusmaya baslayin...
              </p>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[9px] text-[rgba(255,255,255,0.15)]">
              {peerService.isConnected() ? "Bagli" : "Bagli degil"}
            </span>
            <span className="text-[9px] text-[rgba(255,255,255,0.15)]">
              Gercek zamanli paylasim
            </span>
          </div>
        </Section>
      )}
    </>
  );
}
