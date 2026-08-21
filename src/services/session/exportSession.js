import storage from '../storage';
import { filterReadingsByEffectiveEnd } from './sessionModel';
import { buildCSV, buildRecordingFilename, downloadCSV } from '../../utils/csvExport';

/** Load a saved session's readings and trigger a CSV download - works for a
 * session that just finished or one reopened from History. Respects the
 * session's effective end time, so a trimmed tail is excluded. */
export async function exportSessionCSV(sessionId) {
  const [session, allReadings] = await Promise.all([
    storage.getSession(sessionId),
    storage.getReadings(sessionId)
  ]);

  if (!session) {
    throw new Error('Session not found');
  }

  const readings = filterReadingsByEffectiveEnd(allReadings, session);
  const csv = buildCSV(readings, session.sessionType);
  const filename = buildRecordingFilename(session.startedAt);
  downloadCSV(csv, filename);

  return { session, readings };
}
