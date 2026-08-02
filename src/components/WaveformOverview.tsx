import { useEffect, useRef } from "react";

interface Props {
  peaks: number[];
  progress: number;
  duration: number;
  color: string;
  disabled: boolean;
  deckLabel: string;
  onSeek: (seconds: number) => void;
}

export function WaveformOverview({
  peaks,
  progress,
  duration,
  color,
  disabled,
  deckLabel,
  onSeek,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#09090e";
    context.fillRect(0, 0, width, height);
    if (peaks.length === 0) {
      context.strokeStyle = "#2a2a3a";
      context.setLineDash([4 * pixelRatio, 4 * pixelRatio]);
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();
      return;
    }

    context.setLineDash([]);
    const center = height / 2;
    const barWidth = width / peaks.length;
    for (let index = 0; index < peaks.length; index += 1) {
      const x = index * barWidth;
      const barHeight = Math.max(pixelRatio, peaks[index] * (height * 0.82));
      context.globalAlpha = index / peaks.length <= progress ? 0.28 : 0.82;
      context.fillStyle = color;
      context.fillRect(x, center - barHeight / 2, Math.max(pixelRatio, barWidth * 0.72), barHeight);
    }
    context.globalAlpha = 1;
    const playheadX = Math.min(width - pixelRatio, Math.max(0, progress * width));
    context.fillStyle = "#c8c8d8";
    context.fillRect(playheadX, 0, Math.max(pixelRatio, 1.5 * pixelRatio), height);
  }, [color, peaks, progress]);

  const seekFromClientX = (clientX: number) => {
    if (disabled || duration <= 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <div className="waveform-overview">
      <div className="waveform-label">TRACK ENVELOPE // CLICK OR USE ARROWS TO SEEK</div>
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        role="slider"
        tabIndex={disabled || duration <= 0 ? -1 : 0}
        aria-label={`${deckLabel} waveform position`}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(progress * duration)}
        aria-disabled={disabled || duration <= 0}
        onPointerDown={(event) => seekFromClientX(event.clientX)}
        onKeyDown={(event) => {
          if (disabled || duration <= 0) return;
          const current = progress * duration;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            onSeek(Math.min(duration, Math.max(0, current + (event.key === "ArrowLeft" ? -5 : 5))));
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            onSeek(event.key === "Home" ? 0 : duration);
          }
        }}
      />
    </div>
  );
}
