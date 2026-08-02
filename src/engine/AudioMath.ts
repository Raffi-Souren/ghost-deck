export const MIN_FILTER_HZ = 200;
export const MAX_FILTER_HZ = 20_000;
export const MAX_DECK_GAIN = 1.5;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Convert the stable trace representation (Hz) to a perceptual 0..1 UI value. */
export function filterHzToUnit(freqHz: number): number {
  const frequency = clamp(freqHz, MIN_FILTER_HZ, MAX_FILTER_HZ);
  return Math.log(frequency / MIN_FILTER_HZ) / Math.log(MAX_FILTER_HZ / MIN_FILTER_HZ);
}

/** Convert a perceptual 0..1 UI value to the stable trace representation (Hz). */
export function filterUnitToHz(value: number): number {
  const unit = clamp(value, 0, 1);
  return MIN_FILTER_HZ * Math.pow(MAX_FILTER_HZ / MIN_FILTER_HZ, unit);
}

export function equalPowerGains(value: number): { A: number; B: number } {
  const angle = (clamp(value, 0, 1) * Math.PI) / 2;
  return { A: Math.cos(angle), B: Math.sin(angle) };
}
