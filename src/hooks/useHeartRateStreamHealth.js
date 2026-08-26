import { useRef, useState, useCallback } from 'react';
import bluetooth from '../services/bluetooth';

// Named constants so these can be tuned without hunting through the state machine.
export const WAITING_FOR_DATA_TIMEOUT_MS = 8000;
export const STREAMING_STALE_TIMEOUT_MS = 10000;
export const RESUBSCRIBE_WAIT_MS = 8000;
export const MAX_RECOVERY_ATTEMPTS = 3;
export const RECOVERY_BACKOFF_MS = [1000, 3000, 6000];

/**
 * Tracks heart-rate STREAM health as a concept separate from BLE connection
 * state: a device can report itself "connected" while no HR notifications
 * are actually arriving (a dropped subscription, a radio blip, the strap
 * going to sleep). This hook detects that via a watchdog timer and recovers
 * automatically:
 *
 *   waiting-for-data --(no reading within WAITING_FOR_DATA_TIMEOUT_MS)--> recovering
 *   streaming        --(no reading within STREAMING_STALE_TIMEOUT_MS)---> recovering
 *   recovering: resubscribe on the existing connection, wait RESUBSCRIBE_WAIT_MS;
 *               if still silent, ask the caller for a full reconnect (bounded
 *               retries with backoff); if attempts are exhausted -> failed
 *
 * This hook only manages the *reading subscription* - it does not own the
 * BLE connection itself (each platform's connection hook/component does
 * that) and it never touches an active recording (useRecordingSession keeps
 * running through a recovery; only the reading spigot pauses/resumes).
 *
 * Usage:
 *   const stream = useHeartRateStreamHealth({ onReading, onReconnectNeeded });
 *   const activeConnection = await bluetooth.startNotifications(connection, stream.handleReading);
 *   stream.startMonitoring(activeConnection);
 *   // ...later, on explicit disconnect:
 *   stream.stopMonitoring();
 */
export function useHeartRateStreamHealth({ onReading, onReconnectNeeded }) {
  const [streamState, setStreamState] = useState('disconnected');
  const [lastHeartRateReceivedAt, setLastHeartRateReceivedAt] = useState(null);

  const connectionRef = useRef(null);
  const watchdogRef = useRef(null);
  const recoveryInProgressRef = useRef(false);
  const attemptRef = useRef(0);
  const activeRef = useRef(false);
  const lastHeartRateReceivedAtRef = useRef(null);

  const onReadingRef = useRef(onReading);
  onReadingRef.current = onReading;
  const onReconnectNeededRef = useRef(onReconnectNeeded);
  onReconnectNeededRef.current = onReconnectNeeded;

  // beginRecovery and handleReading each need to call the other; a ref
  // sidesteps the chicken-and-egg problem of two interdependent useCallbacks.
  const beginRecoveryRef = useRef(null);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const handleReading = useCallback((data) => {
    // Some monitors report a 0 BPM "no contact" reading instead of simply
    // falling silent when taken off-skin (observed on real hardware: the
    // notification keeps arriving on schedule, just carrying heartRate: 0).
    // Treat that the same as no data at all - don't reset the watchdog,
    // don't mark the stream as healthy, and don't forward a bogus 0 into
    // the recording/chart pipeline.
    const hasSignal = typeof data?.heartRate === 'number' && data.heartRate > 0;
    if (!hasSignal) return;

    const now = Date.now();
    lastHeartRateReceivedAtRef.current = now;
    setLastHeartRateReceivedAt(now);
    attemptRef.current = 0;
    recoveryInProgressRef.current = false;
    setStreamState('streaming');

    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      if (activeRef.current) beginRecoveryRef.current?.();
    }, STREAMING_STALE_TIMEOUT_MS);

    onReadingRef.current?.(data);
  }, [clearWatchdog]);

  /** Resubscribe to HR notifications on the existing connection (no full reconnect). */
  const resubscribe = useCallback(async () => {
    const connection = connectionRef.current;
    if (!connection) throw new Error('No active connection to resubscribe');
    try {
      await bluetooth.stopNotifications(connection);
    } catch {
      // Best-effort - the platform may already consider notifications stopped.
    }
    const activeConnection = await bluetooth.startNotifications(connection, handleReading);
    connectionRef.current = activeConnection;
    return activeConnection;
  }, [handleReading]);

  const beginRecovery = useCallback(async () => {
    if (recoveryInProgressRef.current || !activeRef.current) return;
    recoveryInProgressRef.current = true;
    setStreamState('recovering');
    clearWatchdog();

    try {
      await resubscribe();
    } catch (err) {
      // The connection itself is gone - resubscribing on it can't work.
      recoveryInProgressRef.current = false;
      if (activeRef.current) onReconnectNeededRef.current?.();
      return;
    }

    // Give the fresh subscription a chance to produce a reading before escalating.
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      if (!activeRef.current || !recoveryInProgressRef.current) return;

      if (attemptRef.current < MAX_RECOVERY_ATTEMPTS) {
        const backoff = RECOVERY_BACKOFF_MS[Math.min(attemptRef.current, RECOVERY_BACKOFF_MS.length - 1)];
        attemptRef.current += 1;
        setTimeout(() => {
          if (!activeRef.current) return;
          recoveryInProgressRef.current = false;
          onReconnectNeededRef.current?.();
        }, backoff);
      } else {
        recoveryInProgressRef.current = false;
        setStreamState('failed');
      }
    }, RESUBSCRIBE_WAIT_MS);
  }, [clearWatchdog, resubscribe]);

  beginRecoveryRef.current = beginRecovery;

  /** Call once notifications are subscribed on a fresh (or recovered) connection. */
  const startMonitoring = useCallback((connection) => {
    connectionRef.current = connection;
    activeRef.current = true;
    attemptRef.current = 0;
    recoveryInProgressRef.current = false;
    setStreamState('waiting-for-data');

    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      if (activeRef.current) beginRecoveryRef.current?.();
    }, WAITING_FOR_DATA_TIMEOUT_MS);
  }, [clearWatchdog]);

  /** Call when the connection is deliberately torn down (explicit disconnect, forget device). */
  const stopMonitoring = useCallback(() => {
    activeRef.current = false;
    recoveryInProgressRef.current = false;
    clearWatchdog();
    connectionRef.current = null;
    lastHeartRateReceivedAtRef.current = null;
    setStreamState('disconnected');
    setLastHeartRateReceivedAt(null);
  }, [clearWatchdog]);

  /**
   * Re-check stream health without necessarily doing anything - intended for
   * an app-foreground/resume hook. A perfectly healthy, recently-updated
   * stream is left alone (no reconnect-on-every-resume); a stale one starts
   * the normal recovery path immediately instead of waiting for the next
   * watchdog tick.
   */
  const checkHealthOnResume = useCallback(() => {
    if (!activeRef.current || recoveryInProgressRef.current) return;
    const last = lastHeartRateReceivedAtRef.current;
    const staleThreshold = STREAMING_STALE_TIMEOUT_MS;
    if (last === null || Date.now() - last > staleThreshold) {
      beginRecoveryRef.current?.();
    }
  }, []);

  return {
    streamState,
    lastHeartRateReceivedAt,
    handleReading,
    startMonitoring,
    stopMonitoring,
    checkHealthOnResume
  };
}
