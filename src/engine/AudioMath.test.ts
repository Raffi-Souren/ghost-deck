import { describe, expect, it } from "vitest";
import {
  equalPowerGains,
  filterHzToUnit,
  filterUnitToHz,
  MAX_FILTER_HZ,
  MIN_FILTER_HZ,
} from "./AudioMath";

describe("AudioMath", () => {
  it("round-trips the logarithmic filter mapping", () => {
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      expect(filterHzToUnit(filterUnitToHz(value))).toBeCloseTo(value, 10);
    }
  });

  it("maps filter endpoints and a perceptual midpoint", () => {
    expect(filterUnitToHz(0)).toBe(MIN_FILTER_HZ);
    expect(filterUnitToHz(1)).toBeCloseTo(MAX_FILTER_HZ, 8);
    expect(filterUnitToHz(0.5)).toBeCloseTo(2_000, 8);
    expect(filterUnitToHz(-1)).toBe(MIN_FILTER_HZ);
    expect(filterUnitToHz(2)).toBeCloseTo(MAX_FILTER_HZ, 8);
  });

  it("keeps crossfader power constant", () => {
    expect(equalPowerGains(0)).toEqual({ A: 1, B: 0 });
    expect(equalPowerGains(1).A).toBeCloseTo(0, 10);
    expect(equalPowerGains(1).B).toBe(1);
    for (const value of [0, 0.25, 0.5, 0.75, 1]) {
      const gains = equalPowerGains(value);
      expect(gains.A ** 2 + gains.B ** 2).toBeCloseTo(1, 10);
    }
  });
});
