import type { ReplayOutcome } from "../engine/ReplayMetrics";
import { overallTrackMatch } from "../engine/TrackIdentity";

interface Props {
  report: ReplayOutcome | null;
}

function formatMetric(value: number | null) {
  return value === null ? "N/A" : `${value.toFixed(1)} ms`;
}

export function ReplayReportPanel({ report }: Props) {
  if (!report) return null;
  const overall = overallTrackMatch(report.tracks);

  return (
    <section className="replay-report" aria-live="polite" aria-atomic="true">
      <div className="replay-report-header">MEASURED REPLAY // RESULT</div>
      <dl className="replay-metrics">
        <div>
          <dt>TRACE COMPLETION</dt>
          <dd data-status={report.timing.status}>{report.timing.status.toUpperCase()}</dd>
        </div>
        <div>
          <dt>EVENTS APPLIED</dt>
          <dd>{report.timing.appliedEvents} / {report.timing.expectedEvents}</dd>
        </div>
        <div>
          <dt>TRANSITION LENGTH</dt>
          <dd>{(report.timing.traceDurationMs / 1000).toFixed(2)} s</dd>
        </div>
        <div>
          <dt>MEAN ABS DRIFT</dt>
          <dd>{formatMetric(report.timing.meanAbsoluteDriftMs)}</dd>
        </div>
        <div>
          <dt>P95 TIMING DRIFT</dt>
          <dd>{formatMetric(report.timing.p95AbsoluteDriftMs)}</dd>
        </div>
        <div>
          <dt>MAX TIMING DRIFT</dt>
          <dd>{formatMetric(report.timing.maxAbsoluteDriftMs)}</dd>
        </div>
        <div>
          <dt>TRACK IDENTITY</dt>
          <dd data-status={overall}>{overall.toUpperCase()}</dd>
        </div>
        <div>
          <dt>FINAL STATE</dt>
          <dd data-status={report.finalState?.matches ? "match" : report.finalState ? "mismatch" : "unknown"}>
            {report.finalState ? (report.finalState.matches ? "MATCH" : "MISMATCH") : "NOT CHECKED"}
          </dd>
        </div>
      </dl>
      <div className="replay-report-detail">
        A {report.tracks.A.toUpperCase()} · B {report.tracks.B.toUpperCase()}
        {report.overrideUsed ? " · LOCAL MISMATCH OVERRIDE USED" : ""}
      </div>
      {report.finalState && !report.finalState.matches && (
        <details>
          <summary>FINAL STATE DIFFERENCES</summary>
          <div>{report.finalState.differences.join(" · ")}</div>
        </details>
      )}
    </section>
  );
}
