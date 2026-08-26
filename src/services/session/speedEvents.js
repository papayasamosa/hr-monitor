import storage from '../storage';
import { createSpeedEventRecord } from './speedEventModel';
import { toCanonicalKmh } from './speedUnits';

/**
 * Record a treadmill speed change for a session: a speed present at
 * recording start, or a mid-recording change, both just create a new
 * timestamped SessionSpeedEvent - the original event is never overwritten,
 * so the session's speed history stays a genuine timeline (e.g. 17:00/5.0,
 * 17:10/5.5, 17:20/6.0 stays three separate records).
 */
export async function recordSpeedChange(sessionId, { enteredValue, enteredUnit, recordedAt }) {
  const event = createSpeedEventRecord({
    sessionId,
    recordedAt: recordedAt || new Date().toISOString(),
    enteredValue,
    enteredUnit
  });
  await storage.addSpeedEvent(event);
  return event;
}

export async function getSpeedEventsForSession(sessionId) {
  return storage.getSpeedEventsForSession(sessionId);
}

/**
 * Edit an existing speed event's value/unit and/or timestamp. The timestamp
 * must stay within the session's recorded window - callers doing UI
 * validation should check against session.startedAt/endedAt before calling
 * this. Re-derives speedCanonical whenever the value or unit changes so the
 * two never drift apart (needs `sessionId` to look the existing event back
 * up, since the repository only lists speed events per-session).
 */
export async function updateSpeedEvent(sessionId, eventId, { enteredValue, enteredUnit, recordedAt }) {
  const events = await storage.getSpeedEventsForSession(sessionId);
  const existing = events.find((e) => e.id === eventId);
  if (!existing) throw new Error(`Speed event not found: ${eventId}`);

  const updates = {};
  if (recordedAt !== undefined) updates.recordedAt = recordedAt;

  const nextValue = enteredValue !== undefined ? enteredValue : existing.enteredValue;
  const nextUnit = enteredUnit !== undefined ? enteredUnit : existing.enteredUnit;
  if (enteredValue !== undefined || enteredUnit !== undefined) {
    updates.enteredValue = nextValue;
    updates.enteredUnit = nextUnit;
    updates.speedCanonical = toCanonicalKmh(nextValue, nextUnit);
  }

  await storage.updateSpeedEvent(eventId, updates);
}

export async function deleteSpeedEvent(eventId) {
  await storage.deleteSpeedEvent(eventId);
}
