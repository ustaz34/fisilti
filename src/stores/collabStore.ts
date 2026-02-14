// P2P isbirligi durum yonetimi — PeerJS ile gercek zamanli transkripsiyon paylasimi
import { create } from "zustand";
import { peerService } from "../lib/peerService";
import { startCollabServer, stopCollabServer } from "../lib/tauri-commands";

export interface CollabPeer {
  id: string;
  name: string;
  isConnected: boolean;
  lastSeen: number;
}

interface CollabState {
  isHosting: boolean;
  sessionId: string | null;
  peers: CollabPeer[];
  sharedTranscript: string;
  serverUrl: string | null;
  serverPort: number | null;
  localIp: string | null;
  isServerStarting: boolean;
  startSession: () => Promise<string>;
  stopSession: () => void;
  connectToPeer: (peerId: string) => Promise<void>;
  updateTranscript: (text: string) => void;
  addPeer: (peer: CollabPeer) => void;
  removePeer: (id: string) => void;
}

export const useCollabStore = create<CollabState>((set, get) => ({
  isHosting: false,
  sessionId: null,
  peers: [],
  sharedTranscript: "",
  serverUrl: null,
  serverPort: null,
  localIp: null,
  isServerStarting: false,

  // Oturum baslat (host olarak)
  startSession: async () => {
    const peerId = await peerService.createSession();

    // Gelen mesajlari dinle
    peerService.onMessage((data) => {
      if (data.type === "transcript") {
        set({ sharedTranscript: data.text ?? "" });
      } else if (data.type === "peer-join") {
        get().addPeer({
          id: data.peerId ?? "",
          name: data.name || "Bilinmeyen",
          isConnected: true,
          lastSeen: Date.now(),
        });
      } else if (data.type === "peer-leave") {
        get().removePeer(data.peerId ?? "");
      }
    });

    set({ isHosting: true, sessionId: peerId });

    // HTTP sunucuyu baslat (mobil tarayici erisimi icin)
    set({ isServerStarting: true });
    try {
      const info = await startCollabServer(peerId);
      set({
        serverUrl: info.url,
        serverPort: info.port,
        localIp: info.local_ip,
        isServerStarting: false,
      });
    } catch (e) {
      console.warn("Collab HTTP sunucu baslatilamadi:", e);
      set({ isServerStarting: false });
    }

    return peerId;
  },

  // Oturumu durdur
  stopSession: () => {
    peerService.disconnect();
    stopCollabServer().catch(() => {});
    set({
      isHosting: false,
      sessionId: null,
      peers: [],
      sharedTranscript: "",
      serverUrl: null,
      serverPort: null,
      localIp: null,
      isServerStarting: false,
    });
  },

  // Baska bir peer'a baglan (client olarak)
  connectToPeer: async (peerId: string) => {
    await peerService.connectTo(peerId);

    // Gelen mesajlari dinle
    peerService.onMessage((data) => {
      if (data.type === "transcript") {
        set({ sharedTranscript: data.text ?? "" });
      } else if (data.type === "peer-join") {
        get().addPeer({
          id: data.peerId ?? "",
          name: data.name || "Bilinmeyen",
          isConnected: true,
          lastSeen: Date.now(),
        });
      } else if (data.type === "peer-leave") {
        get().removePeer(data.peerId ?? "");
      }
    });

    set({ sessionId: peerId });
  },

  // Transkripsiyon guncelle ve diger peer'lara yayinla (append modu)
  updateTranscript: (text: string) => {
    set((state) => {
      const updated = state.sharedTranscript
        ? state.sharedTranscript + "\n" + text
        : text;
      return { sharedTranscript: updated };
    });
    peerService.broadcast({
      type: "transcript",
      text: get().sharedTranscript,
      timestamp: Date.now(),
    });
  },

  // Peer ekle
  addPeer: (peer: CollabPeer) => {
    set((state) => {
      // Tekrar eklemeyi engelle
      if (state.peers.some((p) => p.id === peer.id)) {
        return {
          peers: state.peers.map((p) =>
            p.id === peer.id ? { ...p, isConnected: true, lastSeen: Date.now() } : p
          ),
        };
      }
      return { peers: [...state.peers, peer] };
    });
  },

  // Peer kaldir
  removePeer: (id: string) => {
    set((state) => ({
      peers: state.peers.filter((p) => p.id !== id),
    }));
  },
}));
