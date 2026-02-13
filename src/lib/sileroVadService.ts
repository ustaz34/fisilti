/**
 * Silero VAD servisi — @ricky0123/vad-web ile akilli konusma algilama.
 * Basarisiz olursa graceful fallback: null doner, cagiran kod
 * mevcut frekans-tabanli VAD'a geri doner.
 */

type MicVADInstance = {
  start: () => void;
  pause: () => void;
  destroy: () => void;
};

let vadInstance: MicVADInstance | null = null;
let onSpeechStartCb: (() => void) | null = null;
let onSpeechEndCb: (() => void) | null = null;

/**
 * Silero VAD'i baslatmayi dener.
 * Basarili olursa true, basarisiz olursa false doner (WASM/ONNX yuklenemez vb.)
 */
export async function startSileroVad(
  onSpeechStart: () => void,
  onSpeechEnd: () => void,
): Promise<boolean> {
  await stopSileroVad();
  onSpeechStartCb = onSpeechStart;
  onSpeechEndCb = onSpeechEnd;

  try {
    // Dinamik import — yuklenemezse hata firlatir
    const { MicVAD } = await import("@ricky0123/vad-web");

    vadInstance = await MicVAD.new({
      onSpeechStart: () => {
        onSpeechStartCb?.();
      },
      onSpeechEnd: () => {
        onSpeechEndCb?.();
      },
      // Konusma baslamasi icin threshold (cok yuksek = yumusak ses kacirilir)
      positiveSpeechThreshold: 0.6,
      // Konusma bitmesi icin threshold (start ile arasindaki fark 20-25 puan olmali)
      negativeSpeechThreshold: 0.4,
      // Minimum konusma suresi (ms) — cok kisa sesleri yoksay
      minSpeechMs: 150,
      // Konusma bittikten sonra bekleme (ms) — Turkce uzun heceleri icin yeterli sure
      redemptionMs: 500,
    });

    vadInstance.start();
    // Silero VAD baslatildi
    return true;
  } catch (err) {
    console.warn("[Silero VAD] Baslatilamadi, fallback VAD kullanilacak:", err);
    vadInstance = null;
    return false;
  }
}

export async function stopSileroVad(): Promise<void> {
  if (vadInstance) {
    try {
      vadInstance.pause();
      vadInstance.destroy();
    } catch {
      // Sessizce devam
    }
    vadInstance = null;
  }
  onSpeechStartCb = null;
  onSpeechEndCb = null;
}

export function isSileroVadActive(): boolean {
  return vadInstance !== null;
}
