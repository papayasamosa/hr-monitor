import storage from '../storage';

/**
 * Load sessions (with their readings and speed events) matching the
 * Dashboard's date-range and session-type filters, ready to hand to
 * heartRateAnalytics.js. Kept separate from the pure analytics functions so
 * those stay unit-testable without touching storage at all.
 *
 * @param {object} params
 * @param {number|'all'} params.days - 7, 30, 90, or 'all'
 * @param {'all'|'cardio'|'strength'} params.sessionType
 */
export async function loadSessionsInRange({ days, sessionType }) {
  const allSessions = await storage.listSessions();
  const cutoffMs = days === 'all' ? null : Date.now() - days * 24 * 60 * 60 * 1000;

  const filtered = allSessions.filter((session) => {
    if (sessionType && sessionType !== 'all' && session.sessionType !== sessionType) return false;
    if (cutoffMs !== null && new Date(session.startedAt).getTime() < cutoffMs) return false;
    return true;
  });

  return Promise.all(
    filtered.map(async (session) => {
      const [readings, speedEvents] = await Promise.all([
        storage.getReadings(session.id),
        storage.getSpeedEventsForSession(session.id)
      ]);
      return { session, readings, speedEvents };
    })
  );
}
