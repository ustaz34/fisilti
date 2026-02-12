/**
 * Bulut API kullanim limiti takip store'u.
 * Her provider icin kullanilan dakika ve aylik reset takibi yapar.
 * Veri tauri-plugin-store ile usage.json'a kaydedilir.
 */

import { create } from "zustand";

export interface ProviderUsage {
  minutesUsed: number;
  lastResetDate: string; // YYYY-MM formatinda
}

interface UsageState {
  deepgram: ProviderUsage;
  azure: ProviderUsage;
  googleCloud: ProviderUsage;
  addUsage: (provider: "deepgram" | "azure" | "googleCloud", durationMs: number) => void;
  getRemaining: (provider: "deepgram" | "azure" | "googleCloud") => number;
  resetIfNewMonth: () => void;
  resetProvider: (provider: "deepgram" | "azure" | "googleCloud") => void;
  loadFromDisk: () => Promise<void>;
  saveToDisk: () => Promise<void>;
}

// Ucretsiz limitler (dakika cinsinden)
const LIMITS: Record<string, number> = {
  deepgram: 20000, // $200 kredi ~333 saat = ~20000 dk (tek seferlik)
  azure: 300,      // 5 saat/ay = 300 dk/ay
  googleCloud: 60, // 60 dk/ay
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function defaultUsage(): ProviderUsage {
  return { minutesUsed: 0, lastResetDate: currentMonth() };
}

export const useUsageStore = create<UsageState>((set, get) => ({
  deepgram: defaultUsage(),
  azure: defaultUsage(),
  googleCloud: defaultUsage(),

  addUsage: (provider, durationMs) => {
    const minutes = durationMs / 60000;
    set((state) => ({
      [provider]: {
        ...state[provider],
        minutesUsed: state[provider].minutesUsed + minutes,
      },
    }));
    // Arka planda kaydet
    get().saveToDisk().catch(() => {});
  },

  getRemaining: (provider) => {
    const state = get();
    const limit = LIMITS[provider] ?? 0;
    return Math.max(0, limit - state[provider].minutesUsed);
  },

  resetIfNewMonth: () => {
    const month = currentMonth();
    set((state) => {
      const updates: Partial<UsageState> = {};
      for (const key of ["deepgram", "azure", "googleCloud"] as const) {
        if (state[key].lastResetDate !== month) {
          // Deepgram tek seferlik kredi — aylik reset yok
          if (key === "deepgram") {
            (updates as Record<string, ProviderUsage>)[key] = {
              ...state[key],
              lastResetDate: month,
            };
          } else {
            (updates as Record<string, ProviderUsage>)[key] = {
              minutesUsed: 0,
              lastResetDate: month,
            };
          }
        }
      }
      return updates;
    });
  },

  resetProvider: (provider) => {
    set({ [provider]: defaultUsage() });
    get().saveToDisk().catch(() => {});
  },

  loadFromDisk: async () => {
    try {
      const { Store } = await import("@tauri-apps/plugin-store");
      const store = await Store.load("usage.json");
      const deepgram = await store.get<ProviderUsage>("deepgram");
      const azure = await store.get<ProviderUsage>("azure");
      const googleCloud = await store.get<ProviderUsage>("googleCloud");

      set({
        deepgram: deepgram ?? defaultUsage(),
        azure: azure ?? defaultUsage(),
        googleCloud: googleCloud ?? defaultUsage(),
      });

      // Ay degismisse resetle
      get().resetIfNewMonth();
    } catch {
      // Ilk calisma — varsayilan degerler kullanilir
    }
  },

  saveToDisk: async () => {
    try {
      const { Store } = await import("@tauri-apps/plugin-store");
      const store = await Store.load("usage.json");
      const state = get();
      await store.set("deepgram", state.deepgram);
      await store.set("azure", state.azure);
      await store.set("googleCloud", state.googleCloud);
      await store.save();
    } catch {
      // Kayit hatasi — sessizce devam
    }
  },
}));
