/**
 * TransportControls
 * Record / Stop / Replay Ghost / Clear / Export / Import
 */

import { useRef } from "react";
import type { TraceEvent } from "../engine/TraceRecorder";
import { TraceRecorder } from "../engine/TraceRecorder";

interface Props {
  recorder: TraceRecorder;
  isRecording: boolean;
  isReplaying: boolean;
  events: TraceEvent[];
  onRecord: () => void;
  onStop: () => void;
  onReplay: () => void;
  onClear: () => void;
  onImport: (events: TraceEvent[]) => void;
}

export function TransportControls({
  recorder,
  isRecording,
  isReplaying,
  events,
  onRecord,
  onStop,
  onReplay,
  onClear,
  onImport,
}: Props) {
  const importRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const json = recorder.export();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghost-deck-trace-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        const imported = TraceRecorder.import(raw);
        onImport(imported);
      } catch (err) {
        alert("IMPORT FAILED: " + (err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const duration =
    events.length > 0
      ? ((events[events.length - 1].timestampMs) / 1000).toFixed(1) + "s"
      : "--";

  return (
    <div className="transport">
      <div className="transport-row">
        <button
          className={`btn btn-transport ${isRecording ? "btn-rec--active" : ""}`}
          onClick={onRecord}
          disabled={isRecording || isReplaying}
        >
          ● REC
        </button>
        <button
          className="btn btn-transport"
          onClick={onStop}
          disabled={!isRecording && !isReplaying}
        >
          ■ STOP
        </button>
        <button
          className={`btn btn-transport ${isReplaying ? "btn-ghost--active" : ""}`}
          onClick={onReplay}
          disabled={events.length === 0 || isRecording || isReplaying}
        >
          ◈ REPLAY GHOST
        </button>
        <button
          className="btn btn-transport"
          onClick={onClear}
          disabled={isRecording || isReplaying}
        >
          ✕ CLEAR
        </button>
      </div>

      <div className="transport-row transport-row--meta">
        <span className="meta-label">TRACE EVENTS</span>
        <span className="meta-value">{events.length}</span>
        <span className="meta-label">TRANSITION LENGTH</span>
        <span className="meta-value">{duration}</span>
        <span className="meta-label">MEMORY SLOT</span>
        <span className="meta-value">{events.length > 0 ? "SLOT-1" : "EMPTY"}</span>
      </div>

      <div className="transport-row">
        <button
          className="btn btn-transport"
          onClick={handleExport}
          disabled={events.length === 0 || isRecording}
        >
          ↓ EXPORT TRACE
        </button>
        <label className="btn btn-transport">
          ↑ IMPORT TRACE
          <input type="file" accept=".json" onChange={handleImportFile} ref={importRef} hidden />
        </label>
      </div>
    </div>
  );
}
