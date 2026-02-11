import { useEffect, useRef, useCallback } from "react";
import { accentRgba, type WaveformStyle } from "../lib/themes";

interface WaveLineProps {
  status: "idle" | "recording" | "transcribing";
  waveformStyle?: WaveformStyle;
}

export function WaveLine({ status, waveformStyle = "classic" }: WaveLineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const phaseRef = useRef(0);
  const smoothVolumeRef = useRef(0);
  const smoothBandsRef = useRef<number[]>([0, 0, 0, 0]);
  const prevBandsRef = useRef<number[]>([0, 0, 0, 0]);

  useEffect(() => {
    const initAudio = async () => {
      if (status === "recording") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;
          const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
          const analyser = audioCtx.createAnalyser();

          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.75;

          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);

          audioContextRef.current = audioCtx;
          analyserRef.current = analyser;
          sourceRef.current = source;
          dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
        } catch (err) {
          console.error("Mikrofon hatasi:", err);
        }
      } else {
        if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
        if (analyserRef.current) { analyserRef.current.disconnect(); analyserRef.current = null; }
        if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      }
    };

    initAudio();

    return () => {
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    };
  }, [status]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }
    const width = rect.width;
    const height = rect.height;
    const centerY = height / 2;

    ctx.clearRect(0, 0, width, height);

    // Frekans bantlarina ayir
    const bands = [0, 0, 0, 0];
    let totalVolume = 0;

    if (status === "recording" && analyserRef.current && dataArrayRef.current) {
      analyserRef.current.getByteFrequencyData(dataArrayRef.current);
      const len = dataArrayRef.current.length;
      const bandSize = Math.floor(len / 4);

      for (let b = 0; b < 4; b++) {
        let sum = 0;
        const start = b * bandSize;
        const end = Math.min(start + bandSize, len);
        for (let i = start; i < end; i++) {
          sum += dataArrayRef.current[i];
        }
        bands[b] = sum / (end - start) / 255;
      }

      totalVolume = bands[0] * 0.45 + bands[1] * 0.35 + bands[2] * 0.15 + bands[3] * 0.05;
      totalVolume = Math.min(totalVolume * 2.5, 1.2);
    }

    // Yumusak gecis
    const attackRate = 0.18;
    const releaseRate = 0.03;
    const volDiff = totalVolume - smoothVolumeRef.current;
    smoothVolumeRef.current += volDiff * (volDiff > 0 ? attackRate : releaseRate);

    for (let b = 0; b < 4; b++) {
      const diff = bands[b] - smoothBandsRef.current[b];
      smoothBandsRef.current[b] += diff * (diff > 0 ? 0.15 : 0.04);
    }

    const volume = status === "idle" ? 0.03 : status === "transcribing" ? 0.15 : smoothVolumeRef.current;
    const sBands = smoothBandsRef.current;

    phaseRef.current += 0.025;

    const edgeFade = (t: number): number => {
      const margin = 0.15;
      if (t < margin) return Math.pow(t / margin, 2);
      if (t > 1 - margin) return Math.pow((1 - t) / margin, 2);
      return 1;
    };

    const drawSingleWave = (
      color: string,
      amp: number,
      freq: number,
      phaseOffset: number,
      bandInfluence: number[],
      lineW = 1.5,
    ) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineW;

      for (let x = 0; x <= width; x += 1.5) {
        const t = x / width;
        const envelope = edgeFade(t);
        const bandMod = bandInfluence[0] * sBands[0] + bandInfluence[1] * sBands[1]
                       + bandInfluence[2] * sBands[2] + bandInfluence[3] * sBands[3];
        const dynamicAmp = amp * (0.3 + bandMod * 1.5) * volume;

        const y = centerY
          + Math.sin(t * Math.PI * freq + phaseRef.current * 2 + phaseOffset) * dynamicAmp * height * 0.38 * envelope
          + Math.sin(t * Math.PI * freq * 2.1 + phaseRef.current * 3.1 + phaseOffset * 1.7) * dynamicAmp * height * 0.12 * envelope
          + Math.sin(t * Math.PI * freq * 0.5 + phaseRef.current * 1.3 + phaseOffset * 0.6) * dynamicAmp * height * 0.08 * envelope;

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    // ── Idle state (tum stiller icin ayni) ──
    if (status === "idle") {
      const breathe = Math.sin(phaseRef.current * 0.8) * 0.04 + 0.08;
      ctx.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const t = x / width;
        const envelope = edgeFade(t);
        const y = centerY + Math.sin(t * Math.PI * 4 + phaseRef.current) * 1 * envelope;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = accentRgba(breathe);
      ctx.lineWidth = 0.5;
      ctx.stroke();
      prevBandsRef.current = [...smoothBandsRef.current];
      animationRef.current = requestAnimationFrame(draw);
      return;
    }

    // ── Transcribing state (tum stiller icin ayni) ──
    if (status === "transcribing") {
      ctx.shadowBlur = 6;
      ctx.shadowColor = accentRgba(0.3);
      ctx.beginPath();
      ctx.strokeStyle = accentRgba(0.7);
      ctx.lineWidth = 1.5;
      for (let x = 0; x <= width; x++) {
        const t = x / width;
        const envelope = edgeFade(t);
        const y = centerY + Math.sin(t * Math.PI * 6 - phaseRef.current * 4) * 3.5 * envelope;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      prevBandsRef.current = [...smoothBandsRef.current];
      animationRef.current = requestAnimationFrame(draw);
      return;
    }

    // ── Recording state — dalga stili secimi ──

    if (waveformStyle === "classic") {
      // 3 katmanli orijinal dalga
      ctx.shadowBlur = 12;
      ctx.shadowColor = accentRgba(0.25);
      drawSingleWave(accentRgba(0.3), 1.1, 3, 0, [0.5, 0.3, 0.15, 0.05]);

      ctx.shadowBlur = 6;
      ctx.shadowColor = accentRgba(0.4);
      drawSingleWave(accentRgba(0.55), 0.9, 4, 1.5, [0.35, 0.4, 0.2, 0.05]);

      ctx.shadowBlur = 0;
      drawSingleWave(accentRgba(0.85), 0.7, 5, 3, [0.3, 0.35, 0.25, 0.1]);

    } else if (waveformStyle === "thin") {
      // Tek ince zarif cizgi
      ctx.shadowBlur = 4;
      ctx.shadowColor = accentRgba(0.2);
      drawSingleWave(accentRgba(0.75), 0.8, 5, 0, [0.4, 0.35, 0.2, 0.05], 1);

    } else if (waveformStyle === "thick") {
      // Kalin parlak tek cizgi
      ctx.shadowBlur = 16;
      ctx.shadowColor = accentRgba(0.5);
      drawSingleWave(accentRgba(0.9), 1.0, 4, 0, [0.45, 0.35, 0.15, 0.05], 3);

      // Ustune ince parlak cekirdek
      ctx.shadowBlur = 0;
      drawSingleWave("rgba(255,255,255,0.4)", 1.0, 4, 0, [0.45, 0.35, 0.15, 0.05], 1);

    } else if (waveformStyle === "pulse") {
      // Kalp atisi / nabiz EKG stili
      ctx.shadowBlur = 8;
      ctx.shadowColor = accentRgba(0.3);
      ctx.beginPath();
      ctx.strokeStyle = accentRgba(0.85);
      ctx.lineWidth = 1.5;

      const pulseFreq = 3;
      for (let x = 0; x <= width; x += 1) {
        const t = x / width;
        const envelope = edgeFade(t);
        // Nabiz dalga formu: duz hat + keskin zirveler
        const phase = (t * pulseFreq + phaseRef.current * 0.8) % 1;
        let spike = 0;
        if (phase > 0.35 && phase < 0.4) {
          spike = -Math.sin((phase - 0.35) / 0.05 * Math.PI) * 0.6;
        } else if (phase > 0.4 && phase < 0.5) {
          spike = Math.sin((phase - 0.4) / 0.1 * Math.PI) * 1.2;
        } else if (phase > 0.5 && phase < 0.55) {
          spike = -Math.sin((phase - 0.5) / 0.05 * Math.PI) * 0.3;
        }
        const y = centerY + spike * volume * height * 0.4 * envelope;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

    } else if (waveformStyle === "mirror") {
      // Dolgulu simetrik spektrogram — cubuk dizisi, ust-alt ayna
      ctx.shadowBlur = 6;
      ctx.shadowColor = accentRgba(0.2);

      const slices = 32;
      const gap = 1.5;
      const sliceW = (width - gap * (slices - 1)) / slices;

      for (let i = 0; i < slices; i++) {
        const t = i / (slices - 1);
        const envelope = edgeFade(t);

        // Her dilim icin frekans bantlarindan yukseklik
        const bandIdx = Math.min(Math.floor(t * 4), 3);
        const nextBand = Math.min(bandIdx + 1, 3);
        const bandLerp = (t * 4) - bandIdx;
        const bandVal = sBands[bandIdx] * (1 - bandLerp) + sBands[nextBand] * bandLerp;

        // Dalga modulasyonu ekle (hareket icin)
        const waveMod = Math.sin(t * Math.PI * 3 + phaseRef.current * 2.5) * 0.15 + 1;

        const barH = (bandVal * 0.7 + volume * 0.3) * height * 0.42 * envelope * waveMod;
        const clampedH = Math.max(barH, 0.5);
        const x = i * (sliceW + gap);

        // Ust yari — gradient dolgu
        const gradUp = ctx.createLinearGradient(x, centerY, x, centerY - clampedH);
        gradUp.addColorStop(0, accentRgba(0.6));
        gradUp.addColorStop(0.6, accentRgba(0.35));
        gradUp.addColorStop(1, accentRgba(0.1));
        ctx.fillStyle = gradUp;
        ctx.beginPath();
        ctx.roundRect(x, centerY - clampedH, sliceW, clampedH, 1);
        ctx.fill();

        // Alt yari — daha soluk ayna
        const gradDn = ctx.createLinearGradient(x, centerY, x, centerY + clampedH);
        gradDn.addColorStop(0, accentRgba(0.35));
        gradDn.addColorStop(0.6, accentRgba(0.15));
        gradDn.addColorStop(1, accentRgba(0.03));
        ctx.fillStyle = gradDn;
        ctx.beginPath();
        ctx.roundRect(x, centerY, sliceW, clampedH, 1);
        ctx.fill();
      }

      // Merkez parlak cizgi
      ctx.beginPath();
      ctx.strokeStyle = accentRgba(0.25);
      ctx.lineWidth = 0.5;
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();
      ctx.shadowBlur = 0;

    } else if (waveformStyle === "bars") {
      // Dikey cubuk ekolayzir
      ctx.shadowBlur = 4;
      ctx.shadowColor = accentRgba(0.2);

      const barCount = 24;
      const gap = 2;
      const barW = (width - gap * (barCount - 1)) / barCount;

      for (let i = 0; i < barCount; i++) {
        const t = i / (barCount - 1);
        const envelope = edgeFade(t);
        // Her cubuk icin frekans bantlarindan yukseklik hesapla
        const bandIdx = Math.min(Math.floor(t * 4), 3);
        const bandVal = sBands[bandIdx];
        const h = (bandVal * 0.6 + volume * 0.4) * height * 0.7 * envelope;

        const x = i * (barW + gap);
        const barH = Math.max(h, 1);

        // Gradient cubuk
        const grad = ctx.createLinearGradient(x, centerY - barH / 2, x, centerY + barH / 2);
        grad.addColorStop(0, accentRgba(0.8));
        grad.addColorStop(0.5, accentRgba(0.5));
        grad.addColorStop(1, accentRgba(0.2));

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, centerY - barH / 2, barW, barH, 1.5);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    prevBandsRef.current = [...smoothBandsRef.current];
    animationRef.current = requestAnimationFrame(draw);
  }, [status, waveformStyle]);

  useEffect(() => {
    animationRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full block"
    />
  );
}
