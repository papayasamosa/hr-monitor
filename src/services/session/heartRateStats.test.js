import { describe, it, expect } from 'vitest';
import { calculateHeartRateStats } from './heartRateStats';

function readings(bpms) {
  return bpms.map((heartRate) => ({ heartRate }));
}

describe('calculateHeartRateStats', () => {
  it('returns null for an empty reading set', () => {
    expect(calculateHeartRateStats([])).toBeNull();
    expect(calculateHeartRateStats(undefined)).toBeNull();
  });

  it('handles a single reading: min/avg/max/percentiles all equal that value', () => {
    const stats = calculateHeartRateStats(readings([80]));
    expect(stats).toEqual({ min: 80, p025: 80, average: 80, p975: 80, max: 80, count: 1 });
  });

  it('computes min/max/average/count for a normal set', () => {
    const stats = calculateHeartRateStats(readings([60, 70, 80, 90, 100]));
    expect(stats.min).toBe(60);
    expect(stats.max).toBe(100);
    expect(stats.average).toBe(80);
    expect(stats.count).toBe(5);
  });

  it('is not skewed by a single outlier: percentiles trim it out while min/max still reflect it', () => {
    const values = Array.from({ length: 98 }, () => 100).concat([40, 220]);
    const stats = calculateHeartRateStats(readings(values));
    expect(stats.min).toBe(40);
    expect(stats.max).toBe(220);
    // With 98/100 values at 100, the 2.5th/97.5th percentiles land on the
    // dense middle, not the two outliers.
    expect(stats.p025).toBe(100);
    expect(stats.p975).toBe(100);
  });

  it('percentile method is deterministic nearest-rank (documented in the module)', () => {
    // 10 values 1..10: p2.5 -> ceil(0.025*10)=1st smallest=1; p97.5 -> ceil(0.975*10)=10th=10
    const stats = calculateHeartRateStats(readings([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(stats.p025).toBe(1);
    expect(stats.p975).toBe(10);
  });

  it('order of input readings does not affect the result', () => {
    const a = calculateHeartRateStats(readings([90, 60, 100, 70, 80]));
    const b = calculateHeartRateStats(readings([60, 70, 80, 90, 100]));
    expect(a).toEqual(b);
  });
});
