/**
 * Shared session/reading shapes and pure helpers, used identically by the
 * web (IndexedDB) and Android (SQLite) storage adapters.
 *
 * Session:
 *   { id, startedAt, endedAt, effectiveEndedAt, deviceName, sessionType,
 *     averageHeartRate, minimumHeartRate, maximumHeartRate, readingCount,
 *     status }
 *   status: 'recording' | 'completed' | 'interrupted'
 *
 *   `endedAt` is when Stop was actually pressed (or the device disconnected/
 *   the app recovered an interrupted session) - it never changes after that.
 *   `effectiveEndedAt` starts out equal to `endedAt` but can be trimmed
 *   earlier later (see Edit End Time) to cut off an accidentally
 *   over-recorded tail without deleting the raw readings. All displayed/
 *   exported stats are based on `effectiveEndedAt`, not `endedAt`.
 *
 * Reading:
 *   { sessionId, timestamp (ISO 8601), elapsedMs, heartRate, rrIntervals? }
 */

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createSessionRecord({ deviceName, sessionType }) {
  return {
    id: generateId(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    effectiveEndedAt: null,
    durationMs: null,
    deviceName: deviceName || 'Unknown Device',
    sessionType: sessionType || null,
    averageHeartRate: 0,
    minimumHeartRate: 0,
    maximumHeartRate: 0,
    readingCount: 0,
    status: 'recording'
  };
}

export function createStatsAccumulator() {
  return { sum: 0, count: 0, min: Infinity, max: -Infinity };
}

/** Update the accumulator in O(1) and return the current live stats snapshot */
export function accumulateReading(acc, heartRate) {
  acc.sum += heartRate;
  acc.count += 1;
  acc.min = Math.min(acc.min, heartRate);
  acc.max = Math.max(acc.max, heartRate);
  return statsSnapshot(acc);
}

export function statsSnapshot(acc) {
  if (acc.count === 0) {
    return { average: 0, min: 0, max: 0, count: 0 };
  }
  return {
    average: Math.round(acc.sum / acc.count),
    min: acc.min,
    max: acc.max,
    count: acc.count
  };
}

/** Recompute an accumulator-equivalent snapshot from a full readings array (recovery path) */
export function statsFromReadings(readings) {
  const acc = createStatsAccumulator();
  for (const reading of readings) {
    acc.sum += reading.heartRate;
    acc.count += 1;
    acc.min = Math.min(acc.min, reading.heartRate);
    acc.max = Math.max(acc.max, reading.heartRate);
  }
  return statsSnapshot(acc);
}

/**
 * Only readings at or before a session's effective end time count toward its
 * displayed stats, chart, and CSV export - readings after that (an
 * accidentally over-recorded tail) stay stored but excluded. Used on both
 * platforms so trimming behaves identically.
 */
export function filterReadingsByEffectiveEnd(readings, session) {
  if (!session.effectiveEndedAt) return readings;
  const cutoffMs = new Date(session.effectiveEndedAt).getTime() - new Date(session.startedAt).getTime();
  return readings.filter((r) => r.elapsedMs <= cutoffMs);
}

/** Recompute duration/avg/min/max/count for a session at a given effective end time. */
export function recalculateForEffectiveEnd(session, readings, effectiveEndedAt) {
  const cutoffMs = new Date(effectiveEndedAt).getTime() - new Date(session.startedAt).getTime();
  const included = readings.filter((r) => r.elapsedMs <= cutoffMs);
  const stats = statsFromReadings(included);
  return {
    effectiveEndedAt,
    durationMs: cutoffMs,
    averageHeartRate: stats.average,
    minimumHeartRate: stats.min,
    maximumHeartRate: stats.max,
    readingCount: stats.count
  };
}

export function buildReading({ startedAt, heartRate, rrIntervals }) {
  const now = Date.now();
  return {
    timestamp: new Date(now).toISOString(),
    elapsedMs: now - new Date(startedAt).getTime(),
    heartRate,
    ...(rrIntervals && rrIntervals.length > 0 ? { rrIntervals } : {})
  };
}
