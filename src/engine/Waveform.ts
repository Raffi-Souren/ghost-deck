/** Build a compact, normalized amplitude envelope without retaining extra PCM. */
export function computeWaveformPeaks(
  channels: readonly Float32Array[],
  bucketCount = 320,
): number[] {
  if (channels.length === 0 || channels[0].length === 0 || bucketCount <= 0) return [];
  const length = channels[0].length;
  const count = Math.max(1, Math.min(Math.floor(bucketCount), length));
  const samplesPerBucket = length / count;
  const peaks = new Array<number>(count).fill(0);
  let overallPeak = 0;

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * samplesPerBucket);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * samplesPerBucket));
    const stride = Math.max(1, Math.floor((end - start) / 1_024));
    let peak = 0;
    for (const channel of channels) {
      for (let index = start; index < end; index += stride) {
        peak = Math.max(peak, Math.abs(channel[index] ?? 0));
      }
    }
    peaks[bucket] = peak;
    overallPeak = Math.max(overallPeak, peak);
  }

  if (overallPeak === 0) return peaks;
  return peaks.map((peak) => peak / overallPeak);
}
