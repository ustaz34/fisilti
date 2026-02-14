// PeerJS ile WebRTC P2P baglanti yonetimi — gercek zamanli transkripsiyon paylasimi
import Peer, { DataConnection } from "peerjs";

export interface PeerMessage {
  type: "transcript" | "peer-join" | "peer-leave";
  text?: string;
  peerId?: string;
  name?: string;
  timestamp?: number;
}

type MessageCallback = (data: PeerMessage) => void;

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
    ],
  },
};

class PeerService {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private messageCallbacks: MessageCallback[] = [];
  private reconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private isDestroyed = false;

  // ----- Oturum yonetimi -----

  /** Yeni bir PeerJS peer olustur ve peer ID dondur */
  createSession(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.cleanup();
      this.isDestroyed = false;

      this.peer = new Peer(PEER_CONFIG);

      this.peer.on("open", (id) => {
        console.log("[PeerService] Peer acildi:", id);
        resolve(id);
      });

      this.peer.on("connection", (conn) => {
        this.setupConnection(conn);
      });

      this.peer.on("error", (err) => {
        console.error("[PeerService] Peer hatasi:", err);
        // Peer henuz acilmadiysa reject et
        if (!this.peer?.open) {
          reject(err);
        }
      });

      this.peer.on("disconnected", () => {
        console.warn("[PeerService] Sunucu baglantisi kesildi, yeniden baglaniliyor...");
        if (!this.isDestroyed && this.peer && !this.peer.destroyed) {
          this.peer.reconnect();
        }
      });
    });
  }

  /** Baska bir peer'a data channel ile baglan */
  connectTo(peerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer || this.peer.destroyed) {
        // Peer yoksa once olustur, sonra baglan
        this.createSession()
          .then(() => this.connectTo(peerId))
          .then(resolve)
          .catch(reject);
        return;
      }

      const conn = this.peer.connect(peerId, { reliable: true });

      conn.on("open", () => {
        this.setupConnection(conn);
        // Katildigimizi karsi tarafa bildir
        conn.send({
          type: "peer-join",
          peerId: this.peer?.id,
          timestamp: Date.now(),
        } satisfies PeerMessage);
        resolve();
      });

      conn.on("error", (err) => {
        console.error("[PeerService] Baglanti hatasi:", err);
        reject(err);
      });
    });
  }

  /** Tum baglantilari kapat ve peer'i yok et */
  disconnect(): void {
    this.isDestroyed = true;

    // Ayrilma bildirimini gonder
    const leaveMsg: PeerMessage = {
      type: "peer-leave",
      peerId: this.peer?.id,
      timestamp: Date.now(),
    };
    this.broadcast(leaveMsg);

    this.cleanup();
  }

  // ----- Mesajlasma -----

  /** Tum bagli peer'lara mesaj gonder */
  broadcast(data: PeerMessage): void {
    this.connections.forEach((conn, peerId) => {
      if (conn.open) {
        try {
          conn.send(data);
        } catch (err) {
          console.error(`[PeerService] ${peerId} adresine gonderim hatasi:`, err);
        }
      }
    });
  }

  /** Gelen mesajlari dinle */
  onMessage(callback: MessageCallback): void {
    this.messageCallbacks.push(callback);
  }

  /** Mesaj dinleyicisini kaldir */
  offMessage(callback: MessageCallback): void {
    this.messageCallbacks = this.messageCallbacks.filter((cb) => cb !== callback);
  }

  // ----- Sorgulama -----

  /** Aktif baglantilari dondur */
  getConnections(): Map<string, DataConnection> {
    return new Map(this.connections);
  }

  /** Kendi peer ID'sini dondur */
  getPeerId(): string | null {
    return this.peer?.id ?? null;
  }

  /** Peer acik mi? */
  isConnected(): boolean {
    return this.peer?.open ?? false;
  }

  // ----- Dahili yardimcilar -----

  private setupConnection(conn: DataConnection): void {
    const remotePeerId = conn.peer;

    // Ayni peer'a birden fazla baglanti olmasin
    const existing = this.connections.get(remotePeerId);
    if (existing && existing.open) {
      conn.close();
      return;
    }

    this.connections.set(remotePeerId, conn);
    this.reconnectAttempts.set(remotePeerId, 0);
    console.log("[PeerService] Baglanti kuruldu:", remotePeerId);

    conn.on("data", (raw) => {
      const data = raw as PeerMessage;
      this.notifyListeners(data);
    });

    conn.on("close", () => {
      console.warn("[PeerService] Baglanti kapandi:", remotePeerId);
      this.connections.delete(remotePeerId);
      this.attemptReconnect(remotePeerId);
    });

    conn.on("error", (err) => {
      console.error("[PeerService] Baglanti hatasi:", remotePeerId, err);
      this.connections.delete(remotePeerId);
      this.attemptReconnect(remotePeerId);
    });
  }

  private attemptReconnect(remotePeerId: string): void {
    if (this.isDestroyed || !this.peer || this.peer.destroyed) return;

    const attempts = this.reconnectAttempts.get(remotePeerId) ?? 0;
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        `[PeerService] ${remotePeerId} icin maksimum yeniden baglanti denemesine ulasildi`
      );
      this.reconnectAttempts.delete(remotePeerId);
      // Peer ayrildi bilgisini dinleyicilere bildir
      this.notifyListeners({
        type: "peer-leave",
        peerId: remotePeerId,
        timestamp: Date.now(),
      });
      return;
    }

    // Onceki zamanlayiciyi temizle
    const existingTimer = this.reconnectTimers.get(remotePeerId);
    if (existingTimer) clearTimeout(existingTimer);

    const delay = RECONNECT_DELAY_MS * Math.pow(1.5, attempts); // Exponential backoff
    console.log(
      `[PeerService] ${remotePeerId} icin yeniden baglanti denemesi ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS} — ${Math.round(delay)}ms sonra`
    );

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(remotePeerId);
      if (this.isDestroyed || !this.peer || this.peer.destroyed) return;

      this.reconnectAttempts.set(remotePeerId, attempts + 1);

      const conn = this.peer!.connect(remotePeerId, { reliable: true });

      conn.on("open", () => {
        console.log("[PeerService] Yeniden baglanti basarili:", remotePeerId);
        this.setupConnection(conn);
      });

      conn.on("error", () => {
        this.attemptReconnect(remotePeerId);
      });
    }, delay);

    this.reconnectTimers.set(remotePeerId, timer);
  }

  private notifyListeners(data: PeerMessage): void {
    for (const cb of this.messageCallbacks) {
      try {
        cb(data);
      } catch (err) {
        console.error("[PeerService] Mesaj callback hatasi:", err);
      }
    }
  }

  private cleanup(): void {
    // Zamanlayicilari temizle
    this.reconnectTimers.forEach((timer) => clearTimeout(timer));
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();

    // Baglantilari kapat
    this.connections.forEach((conn) => {
      try {
        conn.close();
      } catch {
        // sessizce gec
      }
    });
    this.connections.clear();

    // Callback'leri temizle
    this.messageCallbacks = [];

    // Peer'i yok et
    if (this.peer && !this.peer.destroyed) {
      try {
        this.peer.destroy();
      } catch {
        // sessizce gec
      }
    }
    this.peer = null;
  }
}

/** Singleton PeerService instance */
export const peerService = new PeerService();
