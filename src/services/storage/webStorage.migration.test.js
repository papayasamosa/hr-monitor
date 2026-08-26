import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

const DB_NAME = 'hr-monitor';

/** Simulate a pre-existing v1 database (no effectiveEndedAt, no speedEvents store). */
function seedV1Database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('startedAt', 'startedAt');
      sessions.createIndex('status', 'status');
      const readings = db.createObjectStore('readings', { keyPath: 'id', autoIncrement: true });
      readings.createIndex('sessionId', 'sessionId');
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['sessions', 'readings'], 'readwrite');
      tx.objectStore('sessions').add({
        id: 'legacy-session-1',
        startedAt: '2025-01-01T10:00:00.000Z',
        endedAt: '2025-01-01T11:00:00.000Z',
        durationMs: 3600000,
        deviceName: 'Old Device',
        sessionType: 'cardio',
        averageHeartRate: 120,
        minimumHeartRate: 90,
        maximumHeartRate: 160,
        readingCount: 2,
        status: 'completed'
        // Note: no effectiveEndedAt field at all - a genuinely pre-v2 record.
      });
      tx.objectStore('readings').add({
        sessionId: 'legacy-session-1',
        timestamp: '2025-01-01T10:00:00.000Z',
        elapsedMs: 0,
        heartRate: 90
      });
      tx.objectStore('readings').add({
        sessionId: 'legacy-session-1',
        timestamp: '2025-01-01T11:00:00.000Z',
        elapsedMs: 3600000,
        heartRate: 160
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe('IndexedDB migration regression: v1 data survives the jump straight to v3', () => {
  beforeEach(async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });

  it('retains all sessions/readings and backfills effectiveEndedAt, with zero speed events and no reset', async () => {
    await seedV1Database();

    // Import fresh so the module's own openDB() call (at the current
    // DB_VERSION = 3) is what performs the upgrade chain, exactly as it
    // would for a real user's existing database.
    const webStorage = await import('./webStorage.js');

    const session = await webStorage.getSession('legacy-session-1');
    expect(session).not.toBeNull();
    expect(session.startedAt).toBe('2025-01-01T10:00:00.000Z');
    expect(session.endedAt).toBe('2025-01-01T11:00:00.000Z');
    expect(session.sessionType).toBe('cardio');
    expect(session.averageHeartRate).toBe(120);
    // v1 -> v2 backfill: effectiveEndedAt defaults to the existing endedAt.
    expect(session.effectiveEndedAt).toBe('2025-01-01T11:00:00.000Z');

    const readings = await webStorage.getReadings('legacy-session-1');
    expect(readings).toHaveLength(2);
    expect(readings.map((r) => r.heartRate).sort((a, b) => a - b)).toEqual([90, 160]);

    // v2 -> v3: new sessions/readings are untouched, and querying speed
    // events for a pre-existing session returns an empty array rather than
    // erroring or inventing data.
    const speedEvents = await webStorage.getSpeedEventsForSession('legacy-session-1');
    expect(speedEvents).toEqual([]);

    const allSessions = await webStorage.listSessions();
    expect(allSessions).toHaveLength(1);
  });
});
