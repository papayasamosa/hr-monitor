/**
 * Android session recorder - the native foreground service (see
 * android/app/.../HrRecorderPlugin.kt + HrRecordingService.kt) owns the
 * entire recording lifecycle: it receives BLE notifications directly via
 * BluetoothGatt callbacks and writes rows straight to SQLite, independent
 * of whether the WebView/React app is foregrounded, paused, or killed.
 *
 * This adapter therefore just starts/stops that native recording and relays
 * its periodic stats snapshots back to the UI - recordReading() is a no-op
 * here since the JS layer never sees individual readings while recording
 * natively (see webBluetooth's 'heartRateReading' event, which still drives
 * the live BPM display independent of persistence).
 */
import HrRecorder from '../nativeHrRecorder';
import storage from '../storage';

// sessionId -> plugin listener handle for the 'recordingStats' event
const statsListeners = new Map();

export async function startRecording({ deviceName, sessionType }, onStats) {
  const { sessionId } = await HrRecorder.startRecording({ deviceName, sessionType });

  if (onStats) {
    const listener = await HrRecorder.addListener('recordingStats', (stats) => {
      if (stats.sessionId === sessionId) onStats(stats);
    });
    statsListeners.set(sessionId, listener);
  }

  return sessionId;
}

// The native service persists readings directly; nothing to do here.
export function recordReading() {}

export async function stopRecording(sessionId, status = 'completed') {
  await HrRecorder.stopRecording({ sessionId, status });

  const listener = statsListeners.get(sessionId);
  if (listener) {
    listener.remove();
    statsListeners.delete(sessionId);
  }

  return storage.getSession(sessionId);
}

/**
 * Called once at app startup: if the process was killed while a foreground
 * recording was active, the native layer finalizes it as 'interrupted' from
 * whatever it had already written to SQLite and reports the session id back.
 */
export async function recoverInterruptedSessions() {
  const { sessionId } = await HrRecorder.recoverInterruptedSessions();
  return sessionId || null;
}
