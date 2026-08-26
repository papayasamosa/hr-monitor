/**
 * Analytics calculations - pure functions over sessions/readings/speed
 * events already loaded from storage. Deliberately kept out of any React
 * component: the Dashboard UI (see components/Dashboard*) only ever calls
 * these and renders the result, so the numbers are identical no matter how
 * many pixels a chart renders at.
 *
 * Every function here respects each session's effective end time - trimmed
 * tails are excluded exactly like everywhere else in the app.
 */
import { filterReadingsByEffectiveEnd } from '../session/sessionModel';
import { createSpeedResolver } from '../session/speedEventModel';
import { normalizeSpeed } from '../session/speedUnits';

function localDateKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * @param {Array<{session: object, readings: Array}>} sessionsWithReadings
 * @returns {Array<{date: string, averageBpm: number, sessionCount: number, readingCount: number, totalDuration: number}>}
 *   Sorted ascending by date. A day with zero eligible readings across all
 *   sessions is simply absent from the result - never a 0 entry.
 */
export function getDailyHeartRateStats(sessionsWithReadings) {
  const byDate = new Map();

  for (const { session, readings } of sessionsWithReadings) {
    const included = filterReadingsByEffectiveEnd(readings, session);
    if (included.length === 0) continue;

    const date = localDateKey(session.startedAt);
    if (!byDate.has(date)) {
      byDate.set(date, { sum: 0, count: 0, sessionIds: new Set(), totalDuration: 0 });
    }
    const bucket = byDate.get(date);

    // Combine raw observations across sessions on the same day - a short
    // session must never carry the same weight as a long one, so this sums
    // every included BPM reading and divides by the total reading count,
    // rather than averaging each session's own average.
    for (const r of included) {
      bucket.sum += r.heartRate;
      bucket.count += 1;
    }
    bucket.sessionIds.add(session.id);
    bucket.totalDuration += session.effectiveEndedAt
      ? new Date(session.effectiveEndedAt).getTime() - new Date(session.startedAt).getTime()
      : session.durationMs || 0;
  }

  return [...byDate.entries()]
    .map(([date, bucket]) => ({
      date,
      averageBpm: bucket.sum / bucket.count,
      sessionCount: bucket.sessionIds.size,
      readingCount: bucket.count,
      totalDuration: bucket.totalDuration
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * @param {Array<{session: object, readings: Array, speedEvents: Array}>} sessionsWithSpeedData
 * @returns {Array<{speed: number, averageBpm: number, readingCount: number, sessionCount: number}>}
 *   Sorted ascending by speed. `speed` is the normalized canonical km/h
 *   bucket - normalizing first means floating-point noise (5.499999 vs
 *   5.500001) never creates two spurious neighboring buckets.
 */
export function getHeartRateBySpeed(sessionsWithSpeedData) {
  const buckets = new Map();

  for (const { session, readings, speedEvents } of sessionsWithSpeedData) {
    if (!speedEvents || speedEvents.length === 0) continue;
    const included = filterReadingsByEffectiveEnd(readings, session);
    const resolveSpeed = createSpeedResolver(speedEvents);
    const sessionSpeeds = new Set();

    for (const reading of included) {
      const canonical = resolveSpeed(reading.timestamp);
      if (canonical === null) continue;
      const speed = normalizeSpeed(canonical);
      if (!buckets.has(speed)) buckets.set(speed, { sum: 0, count: 0, sessionIds: new Set() });
      const bucket = buckets.get(speed);
      bucket.sum += reading.heartRate;
      bucket.count += 1;
      bucket.sessionIds.add(session.id);
      sessionSpeeds.add(speed);
    }
  }

  return [...buckets.entries()]
    .map(([speed, bucket]) => ({
      speed,
      averageBpm: bucket.sum / bucket.count,
      readingCount: bucket.count,
      sessionCount: bucket.sessionIds.size
    }))
    .sort((a, b) => a.speed - b.speed);
}

/**
 * "Is my heart rate getting lower at approximately the same treadmill
 * speed?" - average HR at a specific (normalized) speed, per calendar day,
 * across however many sessions touched that speed that day.
 *
 * @param {Array<{session: object, readings: Array, speedEvents: Array}>} sessionsWithSpeedData
 * @param {number} targetSpeedCanonical - km/h, will be normalized before comparing
 * @returns {Array<{date: string, speed: number, averageBpm: number, durationAtSpeed: number, readingCount: number}>}
 *   Sorted ascending by date.
 */
export function getHeartRateAtSpeedOverTime(sessionsWithSpeedData, targetSpeedCanonical) {
  const target = normalizeSpeed(targetSpeedCanonical);
  const byDate = new Map();

  for (const { session, readings, speedEvents } of sessionsWithSpeedData) {
    if (!speedEvents || speedEvents.length === 0) continue;
    const included = filterReadingsByEffectiveEnd(readings, session);
    const resolveSpeed = createSpeedResolver(speedEvents);
    const sorted = [...included].sort((a, b) => a.elapsedMs - b.elapsedMs);

    let sum = 0;
    let count = 0;
    let durationAtSpeed = 0;
    let previousElapsedMs = null;

    for (const reading of sorted) {
      const canonical = resolveSpeed(reading.timestamp);
      const atTarget = canonical !== null && normalizeSpeed(canonical) === target;
      if (atTarget) {
        sum += reading.heartRate;
        count += 1;
        if (previousElapsedMs !== null) {
          durationAtSpeed += reading.elapsedMs - previousElapsedMs;
        }
      }
      previousElapsedMs = reading.elapsedMs;
    }

    if (count === 0) continue;

    const date = localDateKey(session.startedAt);
    if (!byDate.has(date)) byDate.set(date, { sum: 0, count: 0, durationAtSpeed: 0 });
    const bucket = byDate.get(date);
    bucket.sum += sum;
    bucket.count += count;
    bucket.durationAtSpeed += durationAtSpeed;
  }

  return [...byDate.entries()]
    .map(([date, bucket]) => ({
      date,
      speed: target,
      averageBpm: bucket.sum / bucket.count,
      durationAtSpeed: bucket.durationAtSpeed,
      readingCount: bucket.count
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
