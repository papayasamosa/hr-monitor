/**
 * Shared SessionSpeedEvent model. A speed event is a point-in-time marker:
 * "from this timestamp onward, the treadmill speed was X" - never a
 * duration/range. The active speed for any reading is whichever event's
 * `recordedAt` is the most recent one at-or-before that reading's timestamp
 * (see speedForReading below); a reading before the first event has no
 * active speed at all (never invented/assumed).
 */
import { toCanonicalKmh } from './speedUnits';

/**
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.recordedAt - ISO 8601 timestamp
 * @param {number} params.enteredValue - the raw value the user typed
 * @param {'kmh'|'mph'} params.enteredUnit
 * @returns {{id: string, sessionId: string, recordedAt: string, speedCanonical: number, enteredValue: number, enteredUnit: string}}
 */
export function createSpeedEventRecord({ sessionId, recordedAt, enteredValue, enteredUnit }) {
  return {
    id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    sessionId,
    recordedAt,
    speedCanonical: toCanonicalKmh(enteredValue, enteredUnit),
    enteredValue,
    enteredUnit
  };
}

/**
 * Resolve the active speed (canonical km/h) for a given timestamp, given a
 * list of speed events for the same session. Events do not need to be
 * pre-sorted - this sorts once and does a single linear scan, so calling it
 * per-reading across an already-sorted array of events (the common case) is
 * O(n) total when called incrementally with non-decreasing timestamps, and
 * O(n log n) worst case for a single ad-hoc lookup thanks to the sort.
 *
 * @param {Array<{recordedAt: string, speedCanonical: number}>} speedEvents
 * @param {string} timestampIso
 * @returns {number|null} canonical speed in km/h, or null if the timestamp
 *   is before the first event (or there are no events at all).
 */
export function speedForReading(speedEvents, timestampIso) {
  if (!speedEvents || speedEvents.length === 0) return null;
  const t = new Date(timestampIso).getTime();

  let active = null;
  for (const event of speedEvents) {
    const eventTime = new Date(event.recordedAt).getTime();
    if (eventTime <= t) {
      if (active === null || eventTime >= new Date(active.recordedAt).getTime()) {
        active = event;
      }
    }
  }
  return active ? active.speedCanonical : null;
}

/**
 * Build an efficient lookup function for resolving many readings against
 * the same event list without re-scanning from the start each time.
 * Requires readings to be queried in non-decreasing timestamp order (true
 * for CSV export/analytics, which both walk readings chronologically).
 *
 * @param {Array<{recordedAt: string, speedCanonical: number}>} speedEvents
 * @returns {(timestampIso: string) => number|null}
 */
export function createSpeedResolver(speedEvents) {
  const sorted = [...(speedEvents || [])].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );
  let cursor = 0;

  return (timestampIso) => {
    const t = new Date(timestampIso).getTime();
    while (cursor + 1 < sorted.length && new Date(sorted[cursor + 1].recordedAt).getTime() <= t) {
      cursor += 1;
    }
    if (sorted.length === 0) return null;
    const candidate = sorted[cursor];
    return new Date(candidate.recordedAt).getTime() <= t ? candidate.speedCanonical : null;
  };
}
