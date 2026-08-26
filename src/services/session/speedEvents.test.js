import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import * as webStorage from '../storage/webStorage';
import { recordSpeedChange, getSpeedEventsForSession, updateSpeedEvent, deleteSpeedEvent } from './speedEvents';

async function makeSession(id) {
  await webStorage.createSession({
    id,
    startedAt: '2026-08-21T17:00:00.000Z',
    endedAt: null,
    effectiveEndedAt: null,
    durationMs: null,
    deviceName: 'Treadmill',
    sessionType: 'cardio',
    averageHeartRate: 0,
    minimumHeartRate: 0,
    maximumHeartRate: 0,
    readingCount: 0,
    status: 'recording'
  });
}

describe('speedEvents orchestration (via the shared storage repository, never direct DB access)', () => {
  it('recordSpeedChange creates a new timestamped event each time, in km/h/mph/etc, never overwriting the prior one', async () => {
    await makeSession('s1');

    await recordSpeedChange('s1', { enteredValue: 5.0, enteredUnit: 'kmh', recordedAt: '2026-08-21T17:00:00.000Z' });
    await recordSpeedChange('s1', { enteredValue: 5.5, enteredUnit: 'kmh', recordedAt: '2026-08-21T17:10:00.000Z' });
    await recordSpeedChange('s1', { enteredValue: 3.7, enteredUnit: 'mph', recordedAt: '2026-08-21T17:20:00.000Z' });

    const events = await getSpeedEventsForSession('s1');
    expect(events).toHaveLength(3);
    expect(events[0].speedCanonical).toBe(5.0);
    expect(events[1].speedCanonical).toBe(5.5);
    expect(events[2].enteredUnit).toBe('mph');
    expect(events[2].speedCanonical).toBeCloseTo(3.7 * 1.609344, 1);
  });

  it('updateSpeedEvent recomputes speedCanonical when the value/unit changes', async () => {
    await makeSession('s2');
    const event = await recordSpeedChange('s2', {
      enteredValue: 5.0,
      enteredUnit: 'kmh',
      recordedAt: '2026-08-21T17:00:00.000Z'
    });

    await updateSpeedEvent('s2', event.id, { enteredValue: 4.0, enteredUnit: 'mph' });

    const [updated] = await getSpeedEventsForSession('s2');
    expect(updated.enteredValue).toBe(4.0);
    expect(updated.enteredUnit).toBe('mph');
    expect(updated.speedCanonical).toBeCloseTo(4.0 * 1.609344, 2);
  });

  it('updateSpeedEvent can adjust just the timestamp without touching the speed value', async () => {
    await makeSession('s3');
    const event = await recordSpeedChange('s3', {
      enteredValue: 5.0,
      enteredUnit: 'kmh',
      recordedAt: '2026-08-21T17:00:00.000Z'
    });

    await updateSpeedEvent('s3', event.id, { recordedAt: '2026-08-21T17:05:00.000Z' });

    const [updated] = await getSpeedEventsForSession('s3');
    expect(updated.recordedAt).toBe('2026-08-21T17:05:00.000Z');
    expect(updated.speedCanonical).toBe(5.0);
  });

  it('deleteSpeedEvent removes an add-missing-event style entry cleanly', async () => {
    await makeSession('s4');
    const event = await recordSpeedChange('s4', {
      enteredValue: 5.0,
      enteredUnit: 'kmh',
      recordedAt: '2026-08-21T17:00:00.000Z'
    });

    await deleteSpeedEvent(event.id);

    expect(await getSpeedEventsForSession('s4')).toEqual([]);
  });
});
