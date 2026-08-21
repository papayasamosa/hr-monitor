import storage from '../storage';

/**
 * Change a completed session's effective end time (trim an accidentally
 * over-recorded tail, or restore it back toward the actual recorded stop).
 * Non-destructive: raw readings past the new cutoff stay stored, so this can
 * be called again later with a later time to undo a trim.
 */
export async function setEffectiveEndTime(sessionId, effectiveEndedAtIso) {
  await storage.updateEffectiveEndTime(sessionId, effectiveEndedAtIso);
  return storage.getSession(sessionId);
}

/** Restore the effective end time back to when the recording actually stopped. */
export async function restoreEffectiveEndTime(sessionId) {
  const session = await storage.getSession(sessionId);
  if (!session) throw new Error('Session not found');
  return setEffectiveEndTime(sessionId, session.endedAt);
}
