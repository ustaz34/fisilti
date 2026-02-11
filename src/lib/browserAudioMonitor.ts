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
      audio: deviceId && deviceId.length > 0
        ? { deviceId: { ideal: deviceId } }
        : true,
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
 * Anlik ses seviyesini RMS olarak dondurur.
 * Backend getAudioLevels() ile ayni olcekte (0.0 - ~0.5 arasi).
 * Tipik konusma: 0.01-0.10, sessizlik: <0.005
 */
export function getBrowserAudioLevel(): number {
  if (!analyser) return 0;

  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);

  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / data.length);
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
