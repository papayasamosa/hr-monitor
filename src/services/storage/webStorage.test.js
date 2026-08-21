import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import * as webStorage from './webStorage';

function reading(elapsedMs, heartRate) {
  return {
    timestamp: new Date(elapsedMs).toISOString(),
    elapsedMs,
    heartRate
  };
}

describe('webStorage effective-end-time trimming', () => {
  it('recalculates duration/avg/min/max/count and excludes trimmed readings, but keeps raw data restorable', async () => {
    // Given: start = 17:00, recorded stop = 18:00, effective end = 17:45
    const startedAt = new Date('2026-08-21T17:00:00.000Z');
    const recordedStop = new Date('2026-08-21T18:00:00.000Z');

    const session = {
      id: 'trim-test-session',
      startedAt: startedAt.toISOString(),
      endedAt: null,
      effectiveEndedAt: null,
      durationMs: null,
      deviceName: 'Test Device',
      sessionType: 'cardio',
      averageHeartRate: 0,
      minimumHeartRate: 0,
      maximumHeartRate: 0,
      readingCount: 0,
      status: 'recording'
    };
    await webStorage.createSession(session);

    // 5 readings, one every 15 minutes from start through the recorded stop
    const readingsIn = [
      reading(0, 100), // 17:00
      reading(15 * 60000, 110), // 17:15
      reading(30 * 60000, 105), // 17:30
      reading(45 * 60000, 120), // 17:45 (right at the trim cutoff - should be included)
      reading(60 * 60000, 200) // 18:00 (recorded stop - should be excluded after trim)
    ];
    for (const r of readingsIn) {
      await webStorage.appendReading(session.id, r);
    }

    await webStorage.finalizeSession(session.id, {
      endedAt: recordedStop.toISOString(),
      effectiveEndedAt: recordedStop.toISOString(),
      durationMs: 60 * 60000,
      status: 'completed',
      averageHeartRate: 127,
      minimumHeartRate: 100,
      maximumHeartRate: 200,
      readingCount: 5
    });

    // Sanity: before trimming, everything is included
    const beforeTrim = await webStorage.getSession(session.id);
    expect(beforeTrim.readingCount).toBe(5);
    expect(beforeTrim.durationMs).toBe(60 * 60000);

    // When: the effective end is trimmed to 17:45
    const effectiveEnd = new Date('2026-08-21T17:45:00.000Z').toISOString();
    await webStorage.updateEffectiveEndTime(session.id, effectiveEnd);

    // Then: duration/stats/count are recalculated from only the included readings
    const afterTrim = await webStorage.getSession(session.id);
    expect(afterTrim.effectiveEndedAt).toBe(effectiveEnd);
    expect(afterTrim.durationMs).toBe(45 * 60000);
    expect(afterTrim.readingCount).toBe(4);
    expect(afterTrim.averageHeartRate).toBe(Math.round((100 + 110 + 105 + 120) / 4));
    expect(afterTrim.minimumHeartRate).toBe(100);
    expect(afterTrim.maximumHeartRate).toBe(120); // the 200 reading at 18:00 must be excluded

    // And: the raw 18:00 reading is still in storage, just not counted
    const allReadings = await webStorage.getReadings(session.id);
    expect(allReadings).toHaveLength(5);
    expect(allReadings.some((r) => r.heartRate === 200)).toBe(true);

    // When: the effective end is restored back toward the recorded stop
    await webStorage.updateEffectiveEndTime(session.id, recordedStop.toISOString());

    // Then: the previously-excluded reading counts again, with no data loss
    const afterRestore = await webStorage.getSession(session.id);
    expect(afterRestore.readingCount).toBe(5);
    expect(afterRestore.durationMs).toBe(60 * 60000);
    expect(afterRestore.maximumHeartRate).toBe(200);
  });

  it('deleting a session removes its readings too', async () => {
    const session = {
      id: 'delete-test-session',
      startedAt: new Date().toISOString(),
      endedAt: null,
      effectiveEndedAt: null,
      durationMs: null,
      deviceName: 'Test Device',
      sessionType: 'strength',
      averageHeartRate: 0,
      minimumHeartRate: 0,
      maximumHeartRate: 0,
      readingCount: 0,
      status: 'recording'
    };
    await webStorage.createSession(session);
    await webStorage.appendReading(session.id, reading(0, 90));

    await webStorage.deleteSession(session.id);

    expect(await webStorage.getSession(session.id)).toBeNull();
    expect(await webStorage.getReadings(session.id)).toEqual([]);
  });
});
