/**
 * Waveform / Visualiser
 * Draws a real-time bar-style spectrum from an AnalyserNode.
 */

import { useRef, useEffect } from "react";

interface Props {
  analyser: AnalyserNode;
  color?: string;
  height?: number;
}

export function Visualiser({ analyser, color = "#00ff99", height = 64 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const bufLen = analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, W, H);

      const barW = Math.max(2, Math.floor(W / bufLen) - 1);
      for (let i = 0; i < bufLen; i++) {
        const barH = (data[i] / 255) * H;
        const x = i * (barW + 1);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, H - barH, barW, barH);
      }
      ctx.globalAlpha = 1;
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, color]);

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={height}
      style={{ width: "100%", height, display: "block", imageRendering: "pixelated" }}
    />
  );
}
