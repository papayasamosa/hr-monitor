/**
 * Web session recorder - drives the shared session model against the
 * IndexedDB storage adapter. Each reading is written incrementally as it
 * arrives (not buffered only in React state) so a closed/crashed tab keeps
 * whatever was already captured.
 */
import storage from '../storage';
import {
  createSessionRecord,
  createStatsAccumulator,
  accumulateReading,
  statsSnapshot,
  statsFromReadings,
  buildReading
} from './sessionModel';

// sessionId -> { acc, onStats, startedAt }
const activeRecordings = new Map();

export async function startRecording({ deviceName, sessionType }, onStats) {
  const session = createSessionRecord({ deviceName, sessionType });
  await storage.createSession(session);
  activeRecordings.set(session.id, {
    acc: createStatsAccumulator(),
    onStats,
    startedAt: session.startedAt
  });
  return session.id;
}

export function recordReading(sessionId, { heartRate, rrIntervals }) {
  const entry = activeRecordings.get(sessionId);
  if (!entry) return;

  const reading = buildReading({ startedAt: entry.startedAt, heartRate, rrIntervals });
  storage.appendReading(sessionId, reading).catch((err) => {
    console.error('Failed to persist heart-rate reading:', err);
  });

  const stats = accumulateReading(entry.acc, heartRate);
  if (entry.onStats) entry.onStats(stats);
}

function finalizedUpdates(stats, status, startedAt) {
  const endedAt = new Date().toISOString();
  return {
    endedAt,
    effectiveEndedAt: endedAt,
    durationMs: new Date(endedAt).getTime() - new Date(startedAt).getTime(),
    status,
    averageHeartRate: stats.average,
    minimumHeartRate: stats.min === Infinity ? 0 : stats.min,
    maximumHeartRate: stats.max === -Infinity ? 0 : stats.max,
    readingCount: stats.count
  };
}

export async function stopRecording(sessionId, status = 'completed') {
  const entry = activeRecordings.get(sessionId);
  const stats = entry ? statsSnapshot(entry.acc) : statsFromReadings(await storage.getReadings(sessionId));
  const startedAt = entry ? entry.startedAt : (await storage.getSession(sessionId))?.startedAt;
  activeRecordings.delete(sessionId);

  await storage.finalizeSession(sessionId, finalizedUpdates(stats, status, startedAt));
  return storage.getSession(sessionId);
}

/**
 * Called once at app startup: any session left in 'recording' status means
 * the tab closed/crashed mid-recording. Its readings are already safely in
 * IndexedDB (written incrementally) - finalize it as 'interrupted' rather
 * than leaving it stuck, or worse, deleting it.
 */
export async function recoverInterruptedSessions() {
  const active = await storage.findActiveSession();
  if (!active) return null;

  const readings = await storage.getReadings(active.id);
  const stats = statsFromReadings(readings);
  await storage.finalizeSession(active.id, finalizedUpdates(stats, 'interrupted', active.startedAt));
  return active.id;
}
