import { useEffect, useState } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import type { ControlBus } from "../engine/ControlBus";

interface Props {
  engine: AudioEngine;
  bus: ControlBus;
  ghostValue?: number;
  disabled: boolean;
}

export function Crossfader({ engine, bus, ghostValue, disabled }: Props) {
  const [value, setValue] = useState(() => engine.crossfaderValue);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const engineValue = engine.crossfaderValue;
      setValue((current) => Math.abs(current - engineValue) > 0.0005 ? engineValue : current);
    }, 33);
    return () => window.clearInterval(interval);
  }, [engine]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number(event.target.value);
    if (bus.dispatch("master", "crossfader", nextValue)) setValue(nextValue);
  };

  return (
    <section className={`crossfader-section ${disabled ? "crossfader-section--locked" : ""}`} aria-labelledby="crossfader-title">
      <div className="crossfader-labels">
        <span>A</span>
        <h2 className="crossfader-title" id="crossfader-title">CROSSFADER</h2>
        <span>B</span>
      </div>
      <div className="crossfader-track-wrap">
        <input
          type="range"
          className="crossfader-range"
          aria-label="Master crossfader, Deck A to Deck B"
          min={0}
          max={1}
          step={0.001}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          aria-valuetext={value < 0.48
            ? `Deck A ${Math.round((0.5 - value) * 200)} percent`
            : value > 0.52
              ? `Deck B ${Math.round((value - 0.5) * 200)} percent`
              : "Centered"}
        />
        {ghostValue !== undefined && (
          <div
            className="ghost-marker ghost-marker--xfade"
            style={{ left: `${ghostValue * 100}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="crossfader-value">
        {value < 0.48
          ? `A +${Math.round((0.5 - value) * 200)}%`
          : value > 0.52
            ? `B +${Math.round((value - 0.5) * 200)}%`
            : "CENTER"}
      </div>
      {disabled && <div className="control-lock-label">GHOST HAS CONTROL</div>}
    </section>
  );
}
