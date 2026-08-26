import { isNativePlatform } from '../platform';
import * as webStorage from './webStorage';
import * as androidStorage from './androidStorage';

/**
 * Session storage: IndexedDB on web, SQLite (via the native HrRecorder
 * plugin) on Android. Both adapters expose the identical async interface -
 * createSession, appendReading, finalizeSession, listSessions, getSession,
 * getReadings, deleteSession, findActiveSession, findSessionByImportFingerprint,
 * getSpeedEventsForSession, addSpeedEvent, updateSpeedEvent, deleteSpeedEvent -
 * so the rest of the app never branches on platform.
 */
const storage = isNativePlatform() ? androidStorage : webStorage;

export default storage;
