/**
 * Shared heart-rate statistics utility. This is the single source of truth
 * for summary numbers shown anywhere in the app (session detail, dashboard,
 * chart overlays) - it must always be computed from the COMPLETE set of
 * eligible readings, never from a downsampled/chart-display subset.
 *
 * Percentile method: nearest-rank on the sorted BPM array, matching the
 * behaviour of numpy's default 'linear' interpolation would be overkill for
 * small session sizes, so we use a simple deterministic nearest-rank
 * (rank = ceil(p * n), 1-indexed, clamped to [1, n]). This is intentionally
 * simple, stable across data sizes, and does not require interpolation
 * between elements - it's documented here so a different percentile method
 * is never accidentally substituted later.
 */

function percentileNearestRank(sortedValues, p) {
  const n = sortedValues.length;
  if (n === 0) return null;
  const rank = Math.ceil(p * n);
  const index = Math.min(Math.max(rank, 1), n) - 1;
  return sortedValues[index];
}

/**
 * @param {Array<{heartRate: number}>} readings - already filtered to the
 *   effective session window by the caller (e.g. filterReadingsByEffectiveEnd)
 * @returns {{min: number, p025: number, average: number, p975: number, max: number, count: number}|null}
 *   null when there are no readings.
 */
export function calculateHeartRateStats(readings) {
  if (!readings || readings.length === 0) return null;

  const values = readings.map((r) => r.heartRate).sort((a, b) => a - b);
  const count = values.length;
  const sum = values.reduce((acc, v) => acc + v, 0);

  return {
    min: values[0],
    p025: percentileNearestRank(values, 0.025),
    average: sum / count,
    p975: percentileNearestRank(values, 0.975),
    max: values[count - 1],
    count
  };
}
