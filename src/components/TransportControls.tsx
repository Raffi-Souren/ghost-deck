import { useRef, useState } from "react";
import type { TraceSession } from "../engine/TraceRecorder";
import { MAX_TRACE_FILE_BYTES, TraceRecorder } from "../engine/TraceRecorder";
import type { TrackMatches } from "../engine/TrackIdentity";

interface Props {
  trace: TraceSession | null;
  isRecording: boolean;
  isReplaying: boolean;
  isTrackLoading: boolean;
  recordingStats: { durationMs: number; eventCount: number } | null;
  replayIssue: string | null;
  trackMatches: TrackMatches | null;
  allowMismatch: boolean;
  onAllowMismatch: (allowed: boolean) => void;
  onRecord: () => void;
  onStop: () => void;
  onReplay: () => void;
  onClear: () => void;
  onImport: (trace: TraceSession) => boolean;
  onImportLoadingChange: (loading: boolean) => void;
}

export function TransportControls({
  trace,
  isRecording,
  isReplaying,
  isTrackLoading,
  recordingStats,
  replayIssue,
  trackMatches,
  allowMismatch,
  onAllowMismatch,
  onRecord,
  onStop,
  onReplay,
  onClear,
  onImport,
  onImportLoadingChange,
}: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const importInFlightRef = useRef(false);
  const [isImporting, setIsImporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const busy = isRecording || isReplaying;
  const traceLocked = busy || isImporting;
  const loading = isTrackLoading || isImporting;

  const handleExport = () => {
    if (!trace || traceLocked || importInFlightRef.current) return;
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
    if (!file || busy || isTrackLoading || importInFlightRef.current) return;

    importInFlightRef.current = true;
    setIsImporting(true);
    setNotice(null);
    onImportLoadingChange(true);
    try {
      if (file.size > MAX_TRACE_FILE_BYTES) throw new Error("Trace file exceeds the 5 MB limit");
      const imported = TraceRecorder.parseAndValidate(await file.text());
      if (!onImport(imported)) {
        setNotice({ kind: "error", text: "IMPORT CANCELLED · THE ACTIVE SESSION CHANGED" });
        return;
      }
      setNotice({
        kind: "ok",
        text: imported.tracks.A.status === "unknown"
          ? "V1 TRACE MIGRATED · TRACK IDENTITY UNKNOWN"
          : "V2 TRACE LOADED + VALIDATED",
      });
    } catch (error) {
      setNotice({ kind: "error", text: `IMPORT REJECTED · ${(error as Error).message}` });
    } finally {
      importInFlightRef.current = false;
      setIsImporting(false);
      onImportLoadingChange(false);
    }
  };

  const hasMismatch = trackMatches?.A === "mismatch" || trackMatches?.B === "mismatch";
  const liveStats = isRecording ? recordingStats : null;
  const durationMs = liveStats?.durationMs ?? trace?.durationMs;
  const duration = durationMs === undefined ? "--" : `${(durationMs / 1000).toFixed(2)}s`;
  const eventCount = liveStats?.eventCount ?? trace?.events.length ?? 0;
  const loadingTitle = isImporting
    ? "Wait for trace import to finish"
    : isTrackLoading ? "Wait for track hashing and decoding to finish" : null;

  return (
    <section className="transport" aria-labelledby="transport-title" aria-busy={isImporting}>
      <div className="transport-header">
        <h2 id="transport-title" className="transport-heading">Capture a transition</h2>
        <p className="transport-subtitle">Record your moves. Replay the moment.</p>
      </div>
      <div className="transport-row transport-row--primary">
        <button
          type="button"
          className={`btn btn-transport btn-record ${isRecording ? "btn-rec--active" : ""}`}
          onClick={onRecord}
          disabled={busy || loading}
          title={loadingTitle ?? "Record a performance trace"}
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
          className={`btn btn-transport btn-replay ${isReplaying ? "btn-ghost--active" : ""}`}
          onClick={onReplay}
          disabled={!trace || busy || loading || Boolean(replayIssue)}
          title={loadingTitle ?? replayIssue ?? "Replay the measured trace"}
        >
          ◈ REPLAY GHOST
        </button>
        <button
          type="button"
          className="btn btn-transport"
          onClick={onClear}
          disabled={traceLocked || !trace}
        >
          ✕ CLEAR
        </button>
      </div>

      <div className="transport-row transport-row--meta">
        <span className="meta-label">TRACE EVENTS</span>
        <span className="meta-value">{eventCount}</span>
        <span className="meta-label">REC → STOP</span>
        <span className="meta-value">{duration}</span>
        <span className="meta-label">TRACE FORMAT</span>
        <span className="meta-value">{isRecording ? "RECORDING" : trace ? `V${trace.version}` : "EMPTY"}</span>
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
            disabled={traceLocked}
          />
          ALLOW LOCAL TRACK MISMATCH FOR THIS TRACE
        </label>
      )}

      {replayIssue && <div className="transport-notice transport-notice--error" role="status">{replayIssue}</div>}
      {isImporting && <div className="transport-notice" role="status">READING + VALIDATING TRACE…</div>}
      {notice && (
        <div className={`transport-notice transport-notice--${notice.kind}`} role="status" aria-live="polite">
          {notice.text}
        </div>
      )}

      <div className="transport-row transport-row--files">
        <button type="button" className="btn btn-transport" onClick={handleExport} disabled={!trace || traceLocked}>
          ↓ EXPORT TRACE
        </button>
        <button
          type="button"
          className="btn btn-transport"
          onClick={() => importRef.current?.click()}
          disabled={busy || loading}
          title={loadingTitle ?? "Import a local trace file"}
        >
          ↑ IMPORT TRACE
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImportFile}
          hidden
          disabled={busy || loading}
        />
      </div>
    </section>
  );
}
