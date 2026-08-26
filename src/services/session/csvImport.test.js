import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import storage from '../storage';
import { buildCSV } from '../../utils/csvExport';
import { parseHeartRateCsv, validateImportedSession, importSession } from './csvImport';

const CURRENT_FORMAT_CSV = [
  'timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit',
  '2026-08-21T17:00:00.000Z,0.000,90,cardio,,',
  '2026-08-21T17:00:10.000Z,10.000,95,cardio,5,kmh',
  '2026-08-21T17:00:20.000Z,20.000,100,cardio,5,kmh',
  '2026-08-21T17:00:30.000Z,30.000,105,cardio,6,kmh'
].join('\n');

const OLD_FORMAT_CSV = [
  'timestamp,elapsed_seconds,heart_rate_bpm,session_type',
  '2026-08-22T09:00:00.000Z,0.000,80,strength',
  '2026-08-22T09:00:10.000Z,10.000,85,strength'
].join('\n');

const NO_SESSION_TYPE_CSV = [
  'timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit',
  '2026-08-23T09:00:00.000Z,0.000,80,,,',
  '2026-08-23T09:00:10.000Z,10.000,85,,,'
].join('\n');

const MIXED_VALID_INVALID_CSV = [
  'timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit',
  '2026-08-24T09:00:00.000Z,0.000,80,cardio,,',
  'not-a-timestamp,10.000,85,cardio,,',
  '2026-08-24T09:00:20.000Z,20.000,notanumber,cardio,,',
  '2026-08-24T09:00:30.000Z,30.000,0,cardio,,',
  '2026-08-24T09:00:40.000Z,40.000,90,cardio,,'
].join('\n');

describe('parseHeartRateCsv', () => {
  it('parses the current export format including speed columns', async () => {
    const parsed = await parseHeartRateCsv(CURRENT_FORMAT_CSV, 'current.csv');
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.every((r) => r.valid)).toBe(true);
    expect(parsed.rows[1].speedValue).toBe(5);
    expect(parsed.rows[1].speedUnit).toBe('kmh');
    expect(parsed.warnings).toEqual([]);
  });

  it('parses an older export missing the treadmill columns, forgiving of the missing fields', async () => {
    const parsed = await parseHeartRateCsv(OLD_FORMAT_CSV, 'old.csv');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.every((r) => r.valid)).toBe(true);
    expect(parsed.rows.every((r) => r.speedValue === null)).toBe(true);
    expect(parsed.warnings.some((w) => w.includes('older export format'))).toBe(true);
  });

  it('marks invalid rows (bad timestamp, non-numeric HR, zero HR) without dropping them', async () => {
    const parsed = await parseHeartRateCsv(MIXED_VALID_INVALID_CSV, 'mixed.csv');
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.rows.filter((r) => r.valid)).toHaveLength(2);
    expect(parsed.rows.filter((r) => !r.valid)).toHaveLength(3);
  });

  it('rejects a file with no recognizable timestamp/heart-rate columns', async () => {
    const parsed = await parseHeartRateCsv('foo,bar\n1,2', 'garbage.csv');
    expect(parsed.rows).toEqual([]);
    expect(parsed.warnings.some((w) => w.includes('does not look like'))).toBe(true);
  });
});

describe('validateImportedSession', () => {
  it('builds a CsvImportPreview with correct counts and containsSpeedData for the current format', async () => {
    const parsed = await parseHeartRateCsv(CURRENT_FORMAT_CSV, 'current.csv');
    const preview = validateImportedSession(parsed);
    expect(preview.filename).toBe('current.csv');
    expect(preview.validReadingCount).toBe(4);
    expect(preview.invalidReadingCount).toBe(0);
    expect(preview.sessionType).toBe('cardio');
    expect(preview.containsSpeedData).toBe(true);
    expect(preview.startAt).toBe('2026-08-21T17:00:00.000Z');
    expect(preview.endAt).toBe('2026-08-21T17:00:30.000Z');
    expect(preview.effectiveEndedAt).toBe(preview.endAt);
  });

  it('flags a missing session type so the caller can ask the user for it', async () => {
    const parsed = await parseHeartRateCsv(NO_SESSION_TYPE_CSV, 'no-type.csv');
    const preview = validateImportedSession(parsed);
    expect(preview.sessionType).toBeNull();
    expect(preview.warnings.some((w) => w.includes('No session type'))).toBe(true);
  });

  it('reports invalid rows without counting them as valid', async () => {
    const parsed = await parseHeartRateCsv(MIXED_VALID_INVALID_CSV, 'mixed.csv');
    const preview = validateImportedSession(parsed);
    expect(preview.validReadingCount).toBe(2);
    expect(preview.invalidReadingCount).toBe(3);
    expect(preview.warnings.some((w) => w.includes('skipped'))).toBe(true);
  });
});

describe('importSession', () => {
  it('imports the current format into a new session with reconstructed speed events', async () => {
    const parsed = await parseHeartRateCsv(CURRENT_FORMAT_CSV, 'import-current.csv');
    const result = await importSession(parsed);
    expect(result.duplicate).toBe(false);
    expect(result.readingCount).toBe(4);

    const session = await storage.getSession(result.sessionId);
    expect(session.sessionType).toBe('cardio');
    expect(session.status).toBe('completed');
    expect(session.readingCount).toBe(4);
    expect(session.averageHeartRate).toBe(Math.round((90 + 95 + 100 + 105) / 4));

    const speedEvents = await storage.getSpeedEventsForSession(result.sessionId);
    // Speed changes 5 -> 5 -> 6, so only 2 change points, not 3 rows with speed.
    expect(speedEvents).toHaveLength(2);
    expect(speedEvents[0].speedCanonical).toBe(5);
    expect(speedEvents[1].speedCanonical).toBe(6);
  });

  it('requires an explicit sessionType override when the file has none', async () => {
    const parsed = await parseHeartRateCsv(NO_SESSION_TYPE_CSV, 'no-type-2.csv');
    await expect(importSession(parsed)).rejects.toThrow(/sessionType is required/);

    const result = await importSession(parsed, { sessionType: 'strength' });
    expect(result.duplicate).toBe(false);
    const session = await storage.getSession(result.sessionId);
    expect(session.sessionType).toBe('strength');
  });

  it('importing the identical file twice does not create two sessions (duplicate fingerprint)', async () => {
    const parsedFirst = await parseHeartRateCsv(OLD_FORMAT_CSV, 'dup.csv');
    const first = await importSession(parsedFirst);
    expect(first.duplicate).toBe(false);

    // Same content, different filename - the fingerprint is content-based, not filename-based.
    const parsedSecond = await parseHeartRateCsv(OLD_FORMAT_CSV, 'dup-renamed.csv');
    const second = await importSession(parsedSecond);
    expect(second.duplicate).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);

    const allSessions = await storage.listSessions();
    const matching = allSessions.filter((s) => s.id === first.sessionId);
    expect(matching).toHaveLength(1);
  });

  it('rolls back (deletes) a partially-written session if an insert fails partway through', async () => {
    // Distinct content from every other test's fixture so this doesn't hit the
    // duplicate-fingerprint short-circuit before ever reaching appendReading.
    const ROLLBACK_CSV = [
      'timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit',
      '2026-08-26T08:00:00.000Z,0.000,91,cardio,,',
      '2026-08-26T08:00:10.000Z,10.000,96,cardio,,',
      '2026-08-26T08:00:20.000Z,20.000,201,cardio,,',
      '2026-08-26T08:00:30.000Z,30.000,106,cardio,,'
    ].join('\n');
    const parsed = await parseHeartRateCsv(ROLLBACK_CSV, 'rollback.csv');

    let capturedSessionId = null;
    const originalCreateSession = storage.createSession.bind(storage);
    const createSpy = vi.spyOn(storage, 'createSession').mockImplementation(async (session) => {
      capturedSessionId = session.id;
      return originalCreateSession(session);
    });
    const appendSpy = vi.spyOn(storage, 'appendReading').mockImplementation((sessionId, reading) => {
      if (reading.heartRate === 201) throw new Error('Simulated write failure');
      return Promise.resolve();
    });

    try {
      await expect(importSession(parsed)).rejects.toThrow('Simulated write failure');
    } finally {
      createSpy.mockRestore();
      appendSpy.mockRestore();
    }

    expect(capturedSessionId).not.toBeNull();
    // The partially-written session must have been cleaned up - not left behind half-imported.
    expect(await storage.getSession(capturedSessionId)).toBeNull();
  });

  it('same HR/timestamps with different treadmill speeds is NOT considered a duplicate', async () => {
    const withSpeed = (speedValue) =>
      [
        'timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit',
        `2026-08-27T09:00:00.000Z,0.000,88,cardio,${speedValue},kmh`,
        '2026-08-27T09:00:10.000Z,10.000,90,cardio,,'
      ].join('\n');

    const first = await importSession(await parseHeartRateCsv(withSpeed('5'), 'speed-a.csv'));
    expect(first.duplicate).toBe(false);

    // Identical timestamps/HR, but the treadmill was at a different speed -
    // this must NOT be treated as the same recording.
    const second = await importSession(await parseHeartRateCsv(withSpeed('6'), 'speed-b.csv'));
    expect(second.duplicate).toBe(false);
    expect(second.sessionId).not.toBe(first.sessionId);

    // And re-importing the first file's exact content again IS still a duplicate.
    const firstAgain = await importSession(await parseHeartRateCsv(withSpeed('5'), 'speed-a-renamed.csv'));
    expect(firstAgain.duplicate).toBe(true);
    expect(firstAgain.sessionId).toBe(first.sessionId);
  });

  it('a file without a session type imported once as Cardio and once as Strength is NOT collapsed into the same session', async () => {
    const NO_TYPE_CSV = [
      'timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit',
      '2026-08-28T09:00:00.000Z,0.000,82,,,',
      '2026-08-28T09:00:10.000Z,10.000,84,,,'
    ].join('\n');

    const asCardio = await importSession(await parseHeartRateCsv(NO_TYPE_CSV, 'no-type-a.csv'), { sessionType: 'cardio' });
    expect(asCardio.duplicate).toBe(false);

    const asStrength = await importSession(await parseHeartRateCsv(NO_TYPE_CSV, 'no-type-b.csv'), { sessionType: 'strength' });
    expect(asStrength.duplicate).toBe(false);
    expect(asStrength.sessionId).not.toBe(asCardio.sessionId);

    const sessionA = await storage.getSession(asCardio.sessionId);
    const sessionB = await storage.getSession(asStrength.sessionId);
    expect(sessionA.sessionType).toBe('cardio');
    expect(sessionB.sessionType).toBe('strength');
  });

  it('enforces fingerprint uniqueness at the storage layer, gracefully recovering as a duplicate if the pre-check race is lost', async () => {
    const RACE_CSV = [
      'timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit',
      '2026-08-29T09:00:00.000Z,0.000,77,cardio,,',
      '2026-08-29T09:00:10.000Z,10.000,79,cardio,,'
    ].join('\n');

    // Establish the session a concurrent import would have already won the race to create.
    const real = await importSession(await parseHeartRateCsv(RACE_CSV, 'race-real.csv'));
    expect(real.duplicate).toBe(false);

    // Simulate a second import racing against it: this import's OWN
    // findSessionByImportFingerprint pre-check "misses" (as it would for a
    // genuinely concurrent import that started before the winner committed),
    // then storage.createSession fails exactly as a real unique-index
    // violation would.
    const findSpy = vi.spyOn(storage, 'findSessionByImportFingerprint').mockImplementationOnce(async () => null);
    const createSpy = vi.spyOn(storage, 'createSession').mockImplementationOnce(async () => {
      throw new Error('UNIQUE constraint failed: sessions.import_fingerprint');
    });

    const raced = await importSession(await parseHeartRateCsv(RACE_CSV, 'race-loser.csv'));

    findSpy.mockRestore();
    createSpy.mockRestore();

    // The post-failure recheck (using the real, unmocked lookup) must find
    // the genuine winner and report a duplicate rather than surfacing the
    // raw constraint error.
    expect(raced.duplicate).toBe(true);
    expect(raced.sessionId).toBe(real.sessionId);
  });

  it('round-trips: importing a freshly exported CSV into a clean DB reproduces the same stats', async () => {
    // Build an in-memory "original" session's readings/speed events directly,
    // export them with buildCSV, then import that CSV and compare.
    const readings = [
      { timestamp: '2026-08-25T06:00:00.000Z', elapsedMs: 0, heartRate: 100 },
      { timestamp: '2026-08-25T06:00:10.000Z', elapsedMs: 10000, heartRate: 110 },
      { timestamp: '2026-08-25T06:00:20.000Z', elapsedMs: 20000, heartRate: 120 },
      { timestamp: '2026-08-25T06:00:30.000Z', elapsedMs: 30000, heartRate: 130 }
    ];
    const speedEvents = [
      { recordedAt: '2026-08-25T06:00:00.000Z', speedCanonical: 5 },
      { recordedAt: '2026-08-25T06:00:20.000Z', speedCanonical: 6 }
    ];
    const csv = buildCSV(readings, 'cardio', { speedEvents, speedUnit: 'kmh' });

    const parsed = await parseHeartRateCsv(csv, 'roundtrip.csv');
    const result = await importSession(parsed);

    const importedSession = await storage.getSession(result.sessionId);
    const originalAverage = Math.round((100 + 110 + 120 + 130) / 4);
    expect(importedSession.averageHeartRate).toBe(originalAverage);
    expect(importedSession.minimumHeartRate).toBe(100);
    expect(importedSession.maximumHeartRate).toBe(130);
    expect(importedSession.readingCount).toBe(4);

    const importedSpeedEvents = await storage.getSpeedEventsForSession(result.sessionId);
    expect(importedSpeedEvents.map((e) => e.speedCanonical)).toEqual([5, 6]);
  });
});
