import type { EngineSnapshot } from "./AudioEngine";
import { filterHzToUnit } from "./AudioMath";
import type { TrackMatches } from "./TrackIdentity";

export interface ReplayEventResult {
  eventIndex: number;
  targetTimestampMs: number;
  actualTimestampMs: number;
  driftMs: number;
}

export type ReplayStatus = "completed" | "interrupted";

export interface ReplayTimingReport {
  status: ReplayStatus;
  expectedEvents: number;
  appliedEvents: number;
  traceDurationMs: number;
  actualDurationMs: number;
  meanAbsoluteDriftMs: number | null;
  p95AbsoluteDriftMs: number | null;
  maxAbsoluteDriftMs: number | null;
  eventResults: ReplayEventResult[];
}

export interface SnapshotComparison {
  matches: boolean;
  differences: string[];
}

export interface ReplayOutcome {
  timing: ReplayTimingReport;
  tracks: TrackMatches;
  overrideUsed: boolean;
  finalState: SnapshotComparison | null;
}

export function calculateReplayReport(
  status: ReplayStatus,
  expectedEvents: number,
  traceDurationMs: number,
  actualDurationMs: number,
  eventResults: ReplayEventResult[],
): ReplayTimingReport {
  const absoluteDrifts = eventResults.map((result) => Math.abs(result.driftMs));
  const ordered = [...absoluteDrifts].sort((a, b) => a - b);
  const mean = ordered.length > 0
    ? ordered.reduce((sum, value) => sum + value, 0) / ordered.length
    : null;
  const p95Index = ordered.length > 0 ? Math.ceil(ordered.length * 0.95) - 1 : -1;

  return {
    status,
    expectedEvents,
    appliedEvents: eventResults.length,
    traceDurationMs,
    actualDurationMs,
    meanAbsoluteDriftMs: mean,
    p95AbsoluteDriftMs: p95Index >= 0 ? ordered[p95Index] : null,
    maxAbsoluteDriftMs: ordered.length > 0 ? ordered[ordered.length - 1] : null,
    eventResults: eventResults.map((result) => ({ ...result })),
  };
}

export function compareSnapshots(
  expected: EngineSnapshot,
  actual: EngineSnapshot,
  timingToleranceMs = 100,
): SnapshotComparison {
  const differences: string[] = [];
  const timeToleranceSec = Math.max(0.1, timingToleranceMs / 1000 + 0.05);

  for (const deck of ["A", "B"] as const) {
    const expectedDeck = expected[deck];
    const actualDeck = actual[deck];
    if (expectedDeck.isPlaying !== actualDeck.isPlaying) differences.push(`${deck} play state`);
    if (Math.abs(expectedDeck.currentTime - actualDeck.currentTime) > timeToleranceSec) {
      differences.push(`${deck} position`);
    }
    if (Math.abs(expectedDeck.gain - actualDeck.gain) > 0.01) differences.push(`${deck} gain`);
    if (Math.abs(filterHzToUnit(expectedDeck.filterFreq) - filterHzToUnit(actualDeck.filterFreq)) > 0.01) {
      differences.push(`${deck} filter`);
    }
    if (Math.abs(expectedDeck.delayMix - actualDeck.delayMix) > 0.01) differences.push(`${deck} delay`);
    if (Math.abs(expectedDeck.reverbMix - actualDeck.reverbMix) > 0.01) differences.push(`${deck} reverb`);
  }
  if (Math.abs(expected.crossfader - actual.crossfader) > 0.01) differences.push("crossfader");

  return { matches: differences.length === 0, differences };
}
