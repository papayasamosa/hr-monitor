import { describe, it, expect } from 'vitest';
import {
  createSessionRecord,
  createStatsAccumulator,
  accumulateReading,
  statsFromReadings,
  filterReadingsByEffectiveEnd,
  recalculateForEffectiveEnd
} from './sessionModel';

describe('createSessionRecord', () => {
  it('starts with no end time set and effectiveEndedAt matching endedAt (both null)', () => {
    const session = createSessionRecord({ deviceName: 'Test Device', sessionType: 'cardio' });
    expect(session.status).toBe('recording');
    expect(session.endedAt).toBeNull();
    expect(session.effectiveEndedAt).toBeNull();
  });
});

describe('accumulateReading / statsFromReadings', () => {
  it('agree on average/min/max/count for the same data', () => {
    const acc = createStatsAccumulator();
    const heartRates = [100, 110, 90, 105];
    let last;
    for (const hr of heartRates) last = accumulateReading(acc, hr);

    const fromReadings = statsFromReadings(heartRates.map((heartRate) => ({ heartRate })));
    expect(last).toEqual(fromReadings);
    expect(fromReadings).toEqual({ average: 101, min: 90, max: 110, count: 4 });
  });

  it('returns zeroed stats for no readings', () => {
    expect(statsFromReadings([])).toEqual({ average: 0, min: 0, max: 0, count: 0 });
  });
});

describe('filterReadingsByEffectiveEnd', () => {
  const startedAt = '2026-08-21T17:00:00.000Z';
  const readings = [
    { elapsedMs: 0, heartRate: 100 },
    { elapsedMs: 15 * 60000, heartRate: 110 }, // 17:15
    { elapsedMs: 45 * 60000, heartRate: 120 }, // 17:45
    { elapsedMs: 60 * 60000, heartRate: 130 } // 18:00 (recorded stop)
  ];

  it('returns every reading when there is no effective end set', () => {
    const session = { startedAt, effectiveEndedAt: null };
    expect(filterReadingsByEffectiveEnd(readings, session)).toEqual(readings);
  });

  it('excludes readings after the effective end time', () => {
    // Given: start = 17:00, recorded stop = 18:00, effective end = 17:45
    const session = { startedAt, effectiveEndedAt: '2026-08-21T17:45:00.000Z' };
    const included = filterReadingsByEffectiveEnd(readings, session);
    expect(included).toHaveLength(3);
    expect(included.map((r) => r.heartRate)).toEqual([100, 110, 120]);
  });
});

describe('recalculateForEffectiveEnd', () => {
  it('recomputes duration/avg/min/max/count for the trimmed window (17:00-18:00, trimmed to 17:45)', () => {
    const session = { startedAt: '2026-08-21T17:00:00.000Z' };
    const readings = [
      { elapsedMs: 0, heartRate: 100 },
      { elapsedMs: 15 * 60000, heartRate: 110 },
      { elapsedMs: 45 * 60000, heartRate: 120 },
      { elapsedMs: 60 * 60000, heartRate: 200 } // outside the trimmed window - must not affect stats
    ];

    const result = recalculateForEffectiveEnd(session, readings, '2026-08-21T17:45:00.000Z');

    expect(result.effectiveEndedAt).toBe('2026-08-21T17:45:00.000Z');
    expect(result.durationMs).toBe(45 * 60000);
    expect(result.readingCount).toBe(3);
    expect(result.averageHeartRate).toBe(110); // (100+110+120)/3
    expect(result.minimumHeartRate).toBe(100);
    expect(result.maximumHeartRate).toBe(120);
  });

  it('restoring the effective end back to the recorded stop includes everything again', () => {
    const session = { startedAt: '2026-08-21T17:00:00.000Z' };
    const readings = [
      { elapsedMs: 0, heartRate: 100 },
      { elapsedMs: 60 * 60000, heartRate: 200 }
    ];

    const result = recalculateForEffectiveEnd(session, readings, '2026-08-21T18:00:00.000Z');
    expect(result.readingCount).toBe(2);
    expect(result.maximumHeartRate).toBe(200);
  });
});
