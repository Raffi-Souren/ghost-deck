import { describe, expect, it } from "vitest";
import { calculateReplayReport, compareSnapshots } from "./ReplayMetrics";
import type { EngineSnapshot } from "./AudioEngine";

const snapshot = (): EngineSnapshot => ({
  A: {
    isPlaying: true,
    currentTime: 12,
    duration: 60,
    gain: 0.8,
    filterFreq: 2_000,
    delayMix: 0.2,
    reverbMix: 0.1,
  },
  B: {
    isPlaying: false,
    currentTime: 4,
    duration: 90,
    gain: 1,
    filterFreq: 20_000,
    delayMix: 0,
    reverbMix: 0.4,
  },
  crossfader: 0.35,
});

describe("replay metrics", () => {
  it("calculates real absolute drift aggregates", () => {
    const report = calculateReplayReport("completed", 4, 1_000, 1_004, [
      { eventIndex: 0, targetTimestampMs: 0, actualTimestampMs: 1, driftMs: 1 },
      { eventIndex: 1, targetTimestampMs: 10, actualTimestampMs: 7, driftMs: -3 },
      { eventIndex: 2, targetTimestampMs: 20, actualTimestampMs: 25, driftMs: 5 },
      { eventIndex: 3, targetTimestampMs: 30, actualTimestampMs: 40, driftMs: 10 },
    ]);
    expect(report.meanAbsoluteDriftMs).toBe(4.75);
    expect(report.p95AbsoluteDriftMs).toBe(10);
    expect(report.maxAbsoluteDriftMs).toBe(10);
    expect(report.appliedEvents).toBe(4);
  });

  it("reports N/A metrics when no event was applied", () => {
    const report = calculateReplayReport("interrupted", 2, 1_000, 50, []);
    expect(report.meanAbsoluteDriftMs).toBeNull();
    expect(report.p95AbsoluteDriftMs).toBeNull();
    expect(report.maxAbsoluteDriftMs).toBeNull();
  });

  it("compares final snapshots with documented tolerances", () => {
    const expected = snapshot();
    const close = snapshot();
    close.A.currentTime += 0.08;
    close.A.gain += 0.005;
    close.crossfader += 0.005;
    expect(compareSnapshots(expected, close).matches).toBe(true);

    const different = snapshot();
    different.B.filterFreq = 2_000;
    const comparison = compareSnapshots(expected, different);
    expect(comparison.matches).toBe(false);
    expect(comparison.differences).toContain("B filter");
  });
});
