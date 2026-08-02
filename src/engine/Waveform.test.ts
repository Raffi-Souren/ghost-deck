import { describe, expect, it } from "vitest";
import { computeWaveformPeaks } from "./Waveform";

describe("computeWaveformPeaks", () => {
  it("builds a bounded normalized envelope", () => {
    const peaks = computeWaveformPeaks([
      new Float32Array([0, 0.2, -0.5, 0.1, 1, -0.25, 0.4, 0]),
    ], 4);
    expect(peaks).toHaveLength(4);
    expect(Math.max(...peaks)).toBe(1);
    expect(peaks.every((peak) => peak >= 0 && peak <= 1)).toBe(true);
  });

  it("handles silence and empty input", () => {
    expect(computeWaveformPeaks([], 10)).toEqual([]);
    expect(computeWaveformPeaks([new Float32Array(4)], 2)).toEqual([0, 0]);
  });
});
