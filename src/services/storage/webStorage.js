/**
 * Web storage adapter - persists sessions and readings in IndexedDB.
 * Readings are written incrementally as they arrive rather than buffered
 * only in React state, so a crashed/closed tab doesn't lose captured data.
 */
import { recalculateForEffectiveEnd } from '../session/sessionModel';

const DB_NAME = 'hr-monitor';
const DB_VERSION = 2;
const SESSIONS_STORE = 'sessions';
const READINGS_STORE = 'readings';

let dbPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessions = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        sessions.createIndex('startedAt', 'startedAt');
        sessions.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains(READINGS_STORE)) {
        const readings = db.createObjectStore(READINGS_STORE, { keyPath: 'id', autoIncrement: true });
        readings.createIndex('sessionId', 'sessionId');
      }

      // v1 -> v2: add effectiveEndedAt, defaulting to the existing endedAt so
      // already-recorded sessions aren't affected until someone trims them.
      if (event.oldVersion < 2) {
        const store = request.transaction.objectStore(SESSIONS_STORE);
        store.openCursor().onsuccess = (cursorEvent) => {
          const cursor = cursorEvent.target.result;
          if (!cursor) return;
          const session = cursor.value;
          if (session.effectiveEndedAt === undefined) {
            cursor.update({ ...session, effectiveEndedAt: session.endedAt ?? null });
          }
          cursor.continue();
        };
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getDB() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

export async function createSession(session) {
  const db = await getDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    tx.objectStore(SESSIONS_STORE).add(session);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return session;
}

export async function appendReading(sessionId, reading) {
  const db = await getDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(READINGS_STORE, 'readwrite');
    tx.objectStore(READINGS_STORE).add({ sessionId, ...reading });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function finalizeSession(sessionId, updates) {
  const db = await getDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const store = tx.objectStore(SESSIONS_STORE);
    const getReq = store.get(sessionId);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) {
        reject(new Error(`Session not found: ${sessionId}`));
        return;
      }
      store.put({ ...existing, ...updates });
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Trim (or restore) a completed session's effective end time and recalculate
 * its stats from the readings that fall at or before the new cutoff. Raw
 * readings are never deleted, so this can be changed again later.
 */
export async function updateEffectiveEndTime(sessionId, effectiveEndedAt) {
  const [session, readings] = await Promise.all([getSession(sessionId), getReadings(sessionId)]);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  await finalizeSession(sessionId, recalculateForEffectiveEnd(session, readings, effectiveEndedAt));
}

export async function listSessions() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const req = tx.objectStore(SESSIONS_STORE).getAll();
    req.onsuccess = () => {
      const sessions = req.result.sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
      resolve(sessions);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getSession(sessionId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const req = tx.objectStore(SESSIONS_STORE).get(sessionId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getReadings(sessionId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(READINGS_STORE, 'readonly');
    const index = tx.objectStore(READINGS_STORE).index('sessionId');
    const req = index.getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.elapsedMs - b.elapsedMs));
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSession(sessionId) {
  const db = await getDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([SESSIONS_STORE, READINGS_STORE], 'readwrite');
    tx.objectStore(SESSIONS_STORE).delete(sessionId);

    const index = tx.objectStore(READINGS_STORE).index('sessionId');
    const cursorReq = index.openCursor(IDBKeyRange.only(sessionId));
    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function findActiveSession() {
  const sessions = await listSessions();
  return sessions.find((s) => s.status === 'recording') || null;
}
