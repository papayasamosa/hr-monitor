import { describe, it, expect } from 'vitest';
import { getDailyHeartRateStats, getHeartRateBySpeed, getHeartRateAtSpeedOverTime } from './heartRateAnalytics';

function session(overrides = {}) {
  const startedAt = overrides.startedAt || '2026-08-20T08:00:00.000Z';
  const endedAt = overrides.endedAt || new Date(new Date(startedAt).getTime() + 600000).toISOString();
  return {
    id: 'session-1',
    startedAt,
    endedAt,
    effectiveEndedAt: endedAt,
    durationMs: 600000,
    sessionType: 'cardio',
    status: 'completed',
    ...overrides
  };
}

function reading(elapsedMs, heartRate, baseIso = '2026-08-20T08:00:00.000Z') {
  return { timestamp: new Date(new Date(baseIso).getTime() + elapsedMs).toISOString(), elapsedMs, heartRate };
}

describe('getDailyHeartRateStats', () => {
  it('returns one entry for a single session on a single day', () => {
    const s = session({ id: 's1' });
    const readings = [reading(0, 100), reading(60000, 110), reading(120000, 120)];
    const result = getDailyHeartRateStats([{ session: s, readings }]);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-08-20');
    expect(result[0].averageBpm).toBe(110);
    expect(result[0].sessionCount).toBe(1);
    expect(result[0].readingCount).toBe(3);
  });

  it('combines multiple sessions on the same day as raw observations, not average-of-averages', () => {
    // Session A: 1 reading at 200 BPM. Session B: 9 readings at 100 BPM.
    // Average-of-averages would give (200+100)/2 = 150 - wrong, since it lets
    // the 1-reading session count equally against the 9-reading one.
    const a = session({ id: 'a', startedAt: '2026-08-20T06:00:00.000Z' });
    const b = session({ id: 'b', startedAt: '2026-08-20T18:00:00.000Z' });
    const readingsA = [reading(0, 200, a.startedAt)];
    const readingsB = Array.from({ length: 9 }, (_, i) => reading(i * 1000, 100, b.startedAt));

    const result = getDailyHeartRateStats([
      { session: a, readings: readingsA },
      { session: b, readings: readingsB }
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].sessionCount).toBe(2);
    expect(result[0].readingCount).toBe(10);
    // (200*1 + 100*9) / 10 = 110, not (200+100)/2 = 150
    expect(result[0].averageBpm).toBe(110);
  });

  it('excludes readings trimmed past the effective end time', () => {
    const s = session({ id: 's-trim', effectiveEndedAt: '2026-08-20T08:01:00.000Z' });
    const readings = [reading(0, 100), reading(30000, 110), reading(120000, 999)]; // 999 is past the 60s cutoff
    const result = getDailyHeartRateStats([{ session: s, readings }]);
    expect(result[0].readingCount).toBe(2);
    expect(result[0].averageBpm).toBe(105);
  });

  it('a day with zero eligible readings across all sessions is absent, never a 0 entry', () => {
    const s = session({ id: 's-empty' });
    const result = getDailyHeartRateStats([{ session: s, readings: [] }]);
    expect(result).toEqual([]);
  });

  it('separates different days into separate entries, sorted ascending', () => {
    const day1 = session({ id: 'd1', startedAt: '2026-08-19T08:00:00.000Z' });
    const day2 = session({ id: 'd2', startedAt: '2026-08-21T08:00:00.000Z' });
    const result = getDailyHeartRateStats([
      { session: day2, readings: [reading(0, 100, day2.startedAt)] },
      { session: day1, readings: [reading(0, 90, day1.startedAt)] }
    ]);
    expect(result.map((r) => r.date)).toEqual(['2026-08-19', '2026-08-21']);
  });
});

describe('getHeartRateBySpeed', () => {
  it('buckets readings by their active (normalized) speed', () => {
    const s = session({ id: 's-speed' });
    const readings = [reading(0, 100), reading(60000, 110), reading(120000, 120)];
    const speedEvents = [
      { recordedAt: s.startedAt, speedCanonical: 5.0 },
      { recordedAt: new Date(new Date(s.startedAt).getTime() + 90000).toISOString(), speedCanonical: 6.0 }
    ];
    const result = getHeartRateBySpeed([{ session: s, readings, speedEvents }]);
    expect(result).toEqual([
      { speed: 5.0, averageBpm: 105, readingCount: 2, sessionCount: 1 },
      { speed: 6.0, averageBpm: 120, readingCount: 1, sessionCount: 1 }
    ]);
  });

  it('normalizes floating-point noise so near-identical speeds share one bucket', () => {
    const s1 = session({ id: 'n1' });
    const s2 = session({ id: 'n2' });
    const readings1 = [reading(0, 100, s1.startedAt)];
    const readings2 = [reading(0, 110, s2.startedAt)];
    const result = getHeartRateBySpeed([
      { session: s1, readings: readings1, speedEvents: [{ recordedAt: s1.startedAt, speedCanonical: 5.499999999 }] },
      { session: s2, readings: readings2, speedEvents: [{ recordedAt: s2.startedAt, speedCanonical: 5.500000001 }] }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].readingCount).toBe(2);
  });

  it('excludes readings before the first speed event', () => {
    const s = session({ id: 's-before' });
    const readings = [reading(0, 100)];
    const speedEvents = [{ recordedAt: new Date(new Date(s.startedAt).getTime() + 5000).toISOString(), speedCanonical: 5.0 }];
    const result = getHeartRateBySpeed([{ session: s, readings, speedEvents }]);
    expect(result).toEqual([]);
  });

  it('ignores non-treadmill sessions (no speed events) entirely', () => {
    const cardioNoSpeed = session({ id: 'no-speed' });
    const result = getHeartRateBySpeed([{ session: cardioNoSpeed, readings: [reading(0, 100)], speedEvents: [] }]);
    expect(result).toEqual([]);
  });

  it('mixes treadmill and non-treadmill cardio sessions without erroring, counting only the treadmill one', () => {
    const treadmill = session({ id: 'tm', startedAt: '2026-08-20T06:00:00.000Z' });
    const plainCardio = session({ id: 'plain', startedAt: '2026-08-20T18:00:00.000Z' });
    const result = getHeartRateBySpeed([
      {
        session: treadmill,
        readings: [reading(0, 100, treadmill.startedAt)],
        speedEvents: [{ recordedAt: treadmill.startedAt, speedCanonical: 5.0 }]
      },
      { session: plainCardio, readings: [reading(0, 150, plainCardio.startedAt)], speedEvents: [] }
    ]);
    expect(result).toEqual([{ speed: 5.0, averageBpm: 100, readingCount: 1, sessionCount: 1 }]);
  });
});

describe('getHeartRateAtSpeedOverTime', () => {
  it('tracks average HR at a given speed across separate days', () => {
    const day1 = session({ id: 'day1', startedAt: '2026-08-19T08:00:00.000Z' });
    const day2 = session({ id: 'day2', startedAt: '2026-08-21T08:00:00.000Z' });
    const speedEvents1 = [{ recordedAt: day1.startedAt, speedCanonical: 5.0 }];
    const speedEvents2 = [{ recordedAt: day2.startedAt, speedCanonical: 5.0 }];

    const result = getHeartRateAtSpeedOverTime(
      [
        { session: day1, readings: [reading(0, 130, day1.startedAt), reading(60000, 140, day1.startedAt)], speedEvents: speedEvents1 },
        { session: day2, readings: [reading(0, 115, day2.startedAt), reading(60000, 125, day2.startedAt)], speedEvents: speedEvents2 }
      ],
      5.0
    );

    expect(result).toEqual([
      { date: '2026-08-19', speed: 5.0, averageBpm: 135, durationAtSpeed: 60000, readingCount: 2 },
      { date: '2026-08-21', speed: 5.0, averageBpm: 120, durationAtSpeed: 60000, readingCount: 2 }
    ]);
    // This dataset answers exactly: is HR trending down at ~5 km/h over time?
    expect(result[1].averageBpm).toBeLessThan(result[0].averageBpm);
  });

  it('normalizes the target speed before comparing so 5.5 vs 5.499999 still matches', () => {
    const s = session({ id: 'norm-target' });
    const result = getHeartRateAtSpeedOverTime(
      [{ session: s, readings: [reading(0, 120)], speedEvents: [{ recordedAt: s.startedAt, speedCanonical: 5.499999999 }] }],
      5.5
    );
    expect(result).toHaveLength(1);
    expect(result[0].averageBpm).toBe(120);
  });

  it('excludes days where the session never reached that speed', () => {
    const s = session({ id: 'wrong-speed' });
    const result = getHeartRateAtSpeedOverTime(
      [{ session: s, readings: [reading(0, 120)], speedEvents: [{ recordedAt: s.startedAt, speedCanonical: 8.0 }] }],
      5.0
    );
    expect(result).toEqual([]);
  });
});
