import { useRef, useState } from "react";
import type { TraceSession } from "../engine/TraceRecorder";
import { MAX_TRACE_FILE_BYTES, TraceRecorder } from "../engine/TraceRecorder";
import type { TrackMatches } from "../engine/TrackIdentity";

interface Props {
  trace: TraceSession | null;
  isRecording: boolean;
  isReplaying: boolean;
  isTrackLoading: boolean;
  replayIssue: string | null;
  trackMatches: TrackMatches | null;
  allowMismatch: boolean;
  onAllowMismatch: (allowed: boolean) => void;
  onRecord: () => void;
  onStop: () => void;
  onReplay: () => void;
  onClear: () => void;
  onImport: (trace: TraceSession) => void;
}

export function TransportControls({
  trace,
  isRecording,
  isReplaying,
  isTrackLoading,
  replayIssue,
  trackMatches,
  allowMismatch,
  onAllowMismatch,
  onRecord,
  onStop,
  onReplay,
  onClear,
  onImport,
}: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const busy = isRecording || isReplaying;

  const handleExport = () => {
    if (!trace) return;
    const blob = new Blob([TraceRecorder.export(trace)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ghost-deck-trace-${Date.now()}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
    setNotice({ kind: "ok", text: "TRACE EXPORTED · AUDIO REMAINED LOCAL" });
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;

    try {
      if (file.size > MAX_TRACE_FILE_BYTES) throw new Error("Trace file exceeds the 5 MB limit");
      const imported = TraceRecorder.parseAndValidate(await file.text());
      onImport(imported);
      setNotice({
        kind: "ok",
        text: imported.tracks.A.status === "unknown"
          ? "V1 TRACE MIGRATED · TRACK IDENTITY UNKNOWN"
          : "V2 TRACE LOADED + VALIDATED",
      });
    } catch (error) {
      setNotice({ kind: "error", text: `IMPORT REJECTED · ${(error as Error).message}` });
    }
  };

  const hasMismatch = trackMatches?.A === "mismatch" || trackMatches?.B === "mismatch";
  const duration = trace ? `${(trace.durationMs / 1000).toFixed(2)}s` : "--";

  return (
    <section className="transport" aria-labelledby="transport-title">
      <h2 id="transport-title" className="sr-only">Trace transport controls</h2>
      <div className="transport-row">
        <button
          type="button"
          className={`btn btn-transport ${isRecording ? "btn-rec--active" : ""}`}
          onClick={onRecord}
          disabled={busy || isTrackLoading}
          title={isTrackLoading ? "Wait for track hashing and decoding to finish" : "Record a performance trace"}
        >
          ● REC
        </button>
        <button
          type="button"
          className="btn btn-transport"
          onClick={onStop}
          disabled={!busy}
        >
          ■ STOP
        </button>
        <button
          type="button"
          className={`btn btn-transport ${isReplaying ? "btn-ghost--active" : ""}`}
          onClick={onReplay}
          disabled={!trace || busy || Boolean(replayIssue)}
          title={replayIssue ?? "Replay the measured trace"}
        >
          ◈ REPLAY GHOST
        </button>
        <button
          type="button"
          className="btn btn-transport"
          onClick={onClear}
          disabled={busy || !trace}
        >
          ✕ CLEAR
        </button>
      </div>

      <div className="transport-row transport-row--meta">
        <span className="meta-label">TRACE EVENTS</span>
        <span className="meta-value">{trace?.events.length ?? 0}</span>
        <span className="meta-label">REC → STOP</span>
        <span className="meta-value">{duration}</span>
        <span className="meta-label">TRACE FORMAT</span>
        <span className="meta-value">{trace ? `V${trace.version}` : "EMPTY"}</span>
      </div>

      {trace && trackMatches && (
        <div className="track-match-grid" aria-label="Track identity check">
          {(["A", "B"] as const).map((deck) => {
            const reference = trace.tracks[deck];
            const expectedName = reference.status === "known"
              ? reference.identity?.name ?? "NO TRACK"
              : "LEGACY TRACE";
            return (
              <div className="track-match" key={deck} data-status={trackMatches[deck]}>
                <span>DECK {deck}</span>
                <strong>{trackMatches[deck].toUpperCase()}</strong>
                <span title={expectedName}>{expectedName}</span>
              </div>
            );
          })}
        </div>
      )}

      {hasMismatch && (
        <label className="mismatch-override">
          <input
            type="checkbox"
            checked={allowMismatch}
            onChange={(event) => onAllowMismatch(event.target.checked)}
            disabled={busy}
          />
          ALLOW LOCAL TRACK MISMATCH FOR THIS TRACE
        </label>
      )}

      {replayIssue && <div className="transport-notice transport-notice--error" role="status">{replayIssue}</div>}
      {notice && (
        <div className={`transport-notice transport-notice--${notice.kind}`} role="status" aria-live="polite">
          {notice.text}
        </div>
      )}

      <div className="transport-row">
        <button type="button" className="btn btn-transport" onClick={handleExport} disabled={!trace || busy}>
          ↓ EXPORT TRACE
        </button>
        <button
          type="button"
          className="btn btn-transport"
          onClick={() => importRef.current?.click()}
          disabled={busy}
        >
          ↑ IMPORT TRACE
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImportFile}
          hidden
          disabled={busy}
        />
      </div>
    </section>
  );
}
