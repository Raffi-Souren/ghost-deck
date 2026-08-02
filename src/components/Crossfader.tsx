/**
 * Crossfader component
 */

import type { AudioEngine } from "../engine/AudioEngine";
import type { TraceRecorder } from "../engine/TraceRecorder";
import { useState } from "react";

interface Props {
  engine: AudioEngine;
  recorder: TraceRecorder;
  ghostValue?: number; // 0..1 from ghost overlay
}

export function Crossfader({ engine, recorder, ghostValue }: Props) {
  const [value, setValue] = useState(0.5);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setValue(v);
    engine.setCrossfader(v);
    recorder.record("master", "crossfader", v);
  };

  return (
    <div className="crossfader-section">
      <div className="crossfader-labels">
        <span>A</span>
        <span className="crossfader-title">CROSSFADER</span>
        <span>B</span>
      </div>
      <div className="crossfader-track-wrap">
        <input
          type="range"
          className="crossfader-range"
          min={0}
          max={1}
          step={0.001}
          value={value}
          onChange={handleChange}
        />
        {ghostValue !== undefined && (
          <div
            className="ghost-marker ghost-marker--xfade"
            style={{ left: `${ghostValue * 100}%` }}
            title={`GHOST XFADE: ${ghostValue.toFixed(3)}`}
          />
        )}
      </div>
      <div className="crossfader-value">
        {value < 0.48 ? `A +${Math.round((0.5 - value) * 200)}%` :
         value > 0.52 ? `B +${Math.round((value - 0.5) * 200)}%` : "CENTER"}
      </div>
    </div>
  );
}
