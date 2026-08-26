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
      // A second pre-existing session, also with no importFingerprint at
      // all - both records having the identical "missing" key is exactly
      // the case the v3 unique index on importFingerprint must tolerate
      // (see the migration hazard test below).
      tx.objectStore('sessions').add({
        id: 'legacy-session-2',
        startedAt: '2025-01-02T10:00:00.000Z',
        endedAt: '2025-01-02T10:30:00.000Z',
        durationMs: 1800000,
        deviceName: 'Old Device',
        sessionType: 'strength',
        averageHeartRate: 100,
        minimumHeartRate: 80,
        maximumHeartRate: 140,
        readingCount: 0,
        status: 'completed'
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
  // Only one test in this file actually opens the database: webStorage.js
  // caches its connection at module scope, and a second dynamic import()
  // within the same file resolves to that same cached module rather than
  // re-running openDB() - a second beforeEach delete + reimport would race
  // against (and hang behind) the first test's still-open connection, since
  // nothing here has a way to close it. Keep this to a single test and
  // assert everything - including the migration hazard check - within it.
  it('retains all sessions/readings, backfills effectiveEndedAt, and the v3 UNIQUE importFingerprint index tolerates multiple pre-existing sessions with no fingerprint', async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
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

    // Migration hazard: both legacy sessions have no importFingerprint
    // property at all. If the v3 migration's UNIQUE index treated "missing"
    // as a colliding value, upgrading this database would throw a
    // ConstraintError right here and the user would lose access to their
    // whole database - it must not, since either session simply never
    // reached the "onupgradeneeded already threw" branch to get here.
    const allSessions = await webStorage.listSessions();
    expect(allSessions).toHaveLength(2);
    expect(allSessions.every((s) => s.importFingerprint === undefined)).toBe(true);

    // And the unique constraint must still be live for genuinely new
    // fingerprints going forward - a real duplicate is still rejected while
    // a fresh one is accepted, right after upgrading from this legacy data.
    await webStorage.createSession({
      id: 'new-session-1',
      startedAt: '2025-01-03T10:00:00.000Z',
      endedAt: '2025-01-03T10:10:00.000Z',
      effectiveEndedAt: '2025-01-03T10:10:00.000Z',
      durationMs: 600000,
      deviceName: 'Imported',
      sessionType: 'cardio',
      averageHeartRate: 100,
      minimumHeartRate: 90,
      maximumHeartRate: 110,
      readingCount: 1,
      status: 'completed',
      importFingerprint: 'fingerprint-abc'
    });

    await expect(
      webStorage.createSession({
        id: 'new-session-2',
        startedAt: '2025-01-03T11:00:00.000Z',
        endedAt: '2025-01-03T11:10:00.000Z',
        effectiveEndedAt: '2025-01-03T11:10:00.000Z',
        durationMs: 600000,
        deviceName: 'Imported',
        sessionType: 'cardio',
        averageHeartRate: 100,
        minimumHeartRate: 90,
        maximumHeartRate: 110,
        readingCount: 1,
        status: 'completed',
        importFingerprint: 'fingerprint-abc'
      })
    ).rejects.toThrow();
  });
});
