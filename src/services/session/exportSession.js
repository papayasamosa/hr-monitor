import storage from '../storage';
import { filterReadingsByEffectiveEnd } from './sessionModel';
import { buildCSV, buildRecordingFilename, downloadCSV } from '../../utils/csvExport';

/** Load a saved session's readings and trigger a CSV download - works for a
 * session that just finished or one reopened from History. Respects the
 * session's effective end time, so a trimmed tail is excluded. Includes
 * treadmill speed columns whenever the session has any recorded speed
 * events, rendered in the given display unit (defaults to km/h). */
export async function exportSessionCSV(sessionId, { speedUnit = 'kmh' } = {}) {
  const [session, allReadings, speedEvents] = await Promise.all([
    storage.getSession(sessionId),
    storage.getReadings(sessionId),
    storage.getSpeedEventsForSession(sessionId)
  ]);

  if (!session) {
    throw new Error('Session not found');
  }

  const readings = filterReadingsByEffectiveEnd(allReadings, session);
  const csv = buildCSV(readings, session.sessionType, { speedEvents, speedUnit });
  const filename = buildRecordingFilename(session.startedAt);
  downloadCSV(csv, filename);

  return { session, readings, speedEvents };
}
