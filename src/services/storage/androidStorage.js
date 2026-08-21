/**
 * Android storage adapter - delegates to the native HrRecorder Capacitor
 * plugin (see android/app/.../HrRecorderPlugin.kt), which persists sessions
 * and readings incrementally to SQLite. Mirrors webStorage.js's interface
 * exactly so services/storage/index.js can swap between them transparently.
 */
import HrRecorder from '../nativeHrRecorder';

export async function createSession(session) {
  await HrRecorder.createSession({ session: JSON.stringify(session) });
  return session;
}

export async function appendReading(sessionId, reading) {
  await HrRecorder.appendReading({ sessionId, reading: JSON.stringify(reading) });
}

export async function finalizeSession(sessionId, updates) {
  await HrRecorder.finalizeSession({ sessionId, updates: JSON.stringify(updates) });
}

export async function listSessions() {
  const { sessions } = await HrRecorder.listSessions();
  return JSON.parse(sessions);
}

export async function getSession(sessionId) {
  const { session } = await HrRecorder.getSession({ sessionId });
  return session ? JSON.parse(session) : null;
}

export async function getReadings(sessionId) {
  const { readings } = await HrRecorder.getReadings({ sessionId });
  return JSON.parse(readings);
}

export async function deleteSession(sessionId) {
  await HrRecorder.deleteSession({ sessionId });
}

export async function findActiveSession() {
  const { session } = await HrRecorder.findActiveSession();
  return session ? JSON.parse(session) : null;
}

export async function updateEffectiveEndTime(sessionId, effectiveEndedAt) {
  await HrRecorder.updateEffectiveEndTime({ sessionId, effectiveEndedAt });
}
