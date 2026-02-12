/**
 * Tarayici tarafinda mikrofon ses seviyesi izleme.
 * Web Speech motoru icin VAD (ses algilama esigi) destegi saglar.
 * Web Audio API (getUserMedia + AnalyserNode) kullanir.
 */

let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let mediaStream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;

export async function startBrowserAudioMonitor(deviceId?: string): Promise<void> {
  await stopBrowserAudioMonitor();

  try {
    const constraints: MediaStreamConstraints = {
      audio: {
        ...(deviceId && deviceId.length > 0 ? { deviceId: { ideal: deviceId } } : {}),
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    };

    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.3;

    source = audioContext.createMediaStreamSource(mediaStream);
    source.connect(analyser);
  } catch {
    // Mikrofon erisimi basarisiz — sessizce devam et
    await stopBrowserAudioMonitor();
  }
}

/**
 * Konusma frekans bandina odakli ses seviyesi (300Hz-3400Hz).
 * Ham RMS'ten cok daha dogru: HVAC/trafik/elektronik gurultuyu yoksayar,
 * sadece insan konusma frekanslarini olcer.
 * Backend getAudioLevels() ile ayni olcekte (0.0 - ~0.5 arasi).
 */
export function getBrowserAudioLevel(): number {
  if (!analyser || !audioContext) return 0;

  const bufLen = analyser.frequencyBinCount;
  const freqData = new Float32Array(bufLen);
  analyser.getFloatFrequencyData(freqData); // dB cinsinden

  const sampleRate = audioContext.sampleRate;
  const binHz = sampleRate / analyser.fftSize;

  // Konusma frekans bandi: 300Hz - 3400Hz
  const lowBin = Math.floor(300 / binHz);
  const highBin = Math.min(Math.ceil(3400 / binHz), bufLen - 1);

  let sum = 0;
  let count = 0;
  for (let i = lowBin; i <= highBin; i++) {
    // dB → lineer donusum (getFloatFrequencyData -100dB ~ 0dB arasi doner)
    const linear = Math.pow(10, freqData[i] / 20);
    sum += linear * linear;
    count++;
  }

  return count > 0 ? Math.sqrt(sum / count) : 0;
}

export async function stopBrowserAudioMonitor(): Promise<void> {
  if (source) {
    try { source.disconnect(); } catch { /* */ }
    source = null;
  }
  analyser = null;
  if (audioContext && audioContext.state !== "closed") {
    try { await audioContext.close(); } catch { /* */ }
  }
  audioContext = null;
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
}

export function isBrowserAudioMonitorActive(): boolean {
  return analyser !== null && audioContext !== null;
}
