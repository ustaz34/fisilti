import { useEffect, useRef, useCallback } from "react";
import { useRecordingStore } from "../stores/recordingStore";

export function WaveformVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const barsRef = useRef<number[]>(Array(32).fill(0));
  const { isRecording, audioLevel } = useRecordingStore();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const targetW = rect.width * dpr;
    const targetH = rect.height * dpr;
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      ctx.scale(dpr, dpr);
    }

    const width = rect.width;
    const height = rect.height;
    const barCount = 32;
    const barWidth = width / barCount - 2;
    const centerY = height / 2;

    ctx.clearRect(0, 0, width, height);

    const bars = barsRef.current;

    for (let i = 0; i < barCount; i++) {
      const target = isRecording
        ? Math.random() * audioLevel * 5 + 0.05
        : 0.02;

      bars[i] = bars[i] * 0.85 + target * 0.15;

      const barHeight = Math.max(2, bars[i] * height * 0.8);

      const gradient = ctx.createLinearGradient(
        0,
        centerY - barHeight / 2,
        0,
        centerY + barHeight / 2,
      );

      if (isRecording) {
        gradient.addColorStop(0, "rgba(250, 228, 207, 0.9)");
        gradient.addColorStop(0.5, "rgba(200, 170, 130, 0.7)");
        gradient.addColorStop(1, "rgba(250, 228, 207, 0.9)");
      } else {
        gradient.addColorStop(0, "rgba(255, 255, 255, 0.15)");
        gradient.addColorStop(1, "rgba(255, 255, 255, 0.05)");
      }

      ctx.fillStyle = gradient;
      ctx.beginPath();
      const x = i * (barWidth + 2) + 1;
      const radius = Math.min(barWidth / 2, 2);
      const y = centerY - barHeight / 2;
      ctx.roundRect(x, y, barWidth, barHeight, radius);
      ctx.fill();
    }

    animationRef.current = requestAnimationFrame(draw);
  }, [isRecording, audioLevel]);

  useEffect(() => {
    animationRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationRef.current);
  }, [draw]);

  return (
    <div className="w-full h-16 px-3">
      <canvas
        ref={canvasRef}
        className="w-full h-full rounded-lg"
        style={{ display: "block" }}
      />
    </div>
  );
}
