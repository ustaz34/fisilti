/**
 * Google Cloud Speech-to-Text V2 REST batch servisi.
 * Kayit bitince tek POST ile sonuc alir (streaming degil).
 */

function langToGoogleLocale(lang: string): string {
  const map: Record<string, string> = {
    tr: "tr-TR", en: "en-US", de: "de-DE", fr: "fr-FR",
    es: "es-ES", it: "it-IT", pt: "pt-BR", ru: "ru-RU",
    ja: "ja-JP", zh: "zh-CN",
  };
  return map[lang] || `${lang}-${lang.toUpperCase()}`;
}

/**
 * Float32Array ses verisini 16-bit LINEAR16 PCM'e donusturur ve base64 kodlar.
 */
function float32ToBase64Pcm16(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * number[] (Tauri backend'den gelen i16 PCM verisi) Float32Array'e donusturur.
 */
function int16ArrayToFloat32(data: number[]): Float32Array {
  const float32 = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    float32[i] = data[i] / 32768;
  }
  return float32;
}

export async function transcribeWithGoogleCloud(
  apiKey: string,
  audioData: number[],
  language: string,
): Promise<string> {
  const float32 = int16ArrayToFloat32(audioData);
  const audioBase64 = float32ToBase64Pcm16(float32);
  const locale = langToGoogleLocale(language);

  const endpoint =
    `https://speech.googleapis.com/v2/projects/-/locations/global/recognizers/_:recognize`;

  const body = {
    config: {
      languageCodes: [locale],
      model: "chirp_2",
      features: {
        enableAutomaticPunctuation: true,
      },
    },
    content: audioBase64,
    configMask: "languageCodes,model,features.enableAutomaticPunctuation",
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Cloud hatasi (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  // Sonuclari birlestir
  const texts: string[] = [];
  if (result.results) {
    for (const r of result.results) {
      if (r.alternatives?.[0]?.transcript) {
        texts.push(r.alternatives[0].transcript);
      }
    }
  }

  return texts.join(" ");
}
