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
 * going to sleep or losing skin contact). This hook detects that via a
 * watchdog timer and recovers automatically:
 *
 *   waiting-for-data --(no valid BPM within WAITING_FOR_DATA_TIMEOUT_MS)--> recovering
 *   streaming        --(no valid BPM within STREAMING_STALE_TIMEOUT_MS)---> recovering
 *   recovering: resubscribe on the existing connection, wait RESUBSCRIBE_WAIT_MS;
 *               if still no valid BPM, ask the caller for a full reconnect
 *               (bounded retries with backoff); once MAX_RECOVERY_ATTEMPTS
 *               automatic escalations have produced no valid BPM -> failed
 *
 * The recovery budget (attemptRef) is intentionally NOT tied to whether a
 * BLE reconnect itself succeeds - a successful reconnect that still yields
 * no real heart-rate data is still a failed attempt. The budget only resets
 * on:
 *   (a) an actual valid (heartRate > 0) reading, or
 *   (b) an explicit/manual startMonitoring call (isAutomaticRecovery: false,
 *       the default) - e.g. the user pressing Connect/Reconnect, or the
 *       app's own initial silent-reconnect-on-launch.
 * A startMonitoring call that resulted from this hook's own automatic
 * recovery escalation (isAutomaticRecovery: true) must NOT reset the
 * budget, or the loop becomes effectively unbounded across full-reconnect
 * cycles - each successful radio-level reconnect would otherwise wipe out
 * the failure count even though the actual symptom (no real BPM) persists.
 * Once 'failed' is reached, no further automatic recovery is scheduled;
 * only another explicit/manual startMonitoring call can leave that state.
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
 *   // ...inside onReconnectNeeded, after a successful automatic reconnect:
 *   stream.startMonitoring(freshConnection, { isAutomaticRecovery: true });
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
  const failedRef = useRef(false);
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
    // Treat that the same as no data at all - don't reset the watchdog or
    // the recovery budget, don't mark the stream as healthy, and don't
    // forward a bogus 0 into the recording/chart pipeline.
    const hasSignal = typeof data?.heartRate === 'number' && data.heartRate > 0;
    if (!hasSignal) return;

    const now = Date.now();
    lastHeartRateReceivedAtRef.current = now;
    setLastHeartRateReceivedAt(now);
    // A real reading is the ONLY thing that resets the automatic-recovery
    // failure budget - a successful radio-level reconnect alone does not
    // (see startMonitoring's isAutomaticRecovery param).
    attemptRef.current = 0;
    failedRef.current = false;
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

  /**
   * Consume one unit of the bounded automatic-recovery budget: either
   * schedule the next full-reconnect escalation (with backoff), or - once
   * MAX_RECOVERY_ATTEMPTS automatic escalations have produced no valid BPM -
   * settle into 'failed' and stop scheduling any further automatic work.
   * Shared by both places recovery can dead-end (resubscribe throwing
   * outright, and a resubscribe that "succeeds" but still yields silence)
   * so neither path can loop unbounded.
   */
  const escalateOrFail = useCallback(() => {
    if (!activeRef.current) return;

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
      failedRef.current = true;
      setStreamState('failed');
    }
  }, []);

  const beginRecovery = useCallback(async () => {
    if (recoveryInProgressRef.current || !activeRef.current || failedRef.current) return;
    recoveryInProgressRef.current = true;
    setStreamState('recovering');
    clearWatchdog();

    try {
      await resubscribe();
    } catch (err) {
      // The connection itself is gone - resubscribing on it can't work.
      // This still consumes one unit of the bounded budget, exactly like a
      // resubscribe that "succeeds" but never yields a reading - otherwise
      // a connection that's permanently gone would escalate forever.
      escalateOrFail();
      return;
    }

    // Give the fresh subscription a chance to produce a reading before escalating.
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      if (!activeRef.current || !recoveryInProgressRef.current) return;
      escalateOrFail();
    }, RESUBSCRIBE_WAIT_MS);
  }, [clearWatchdog, resubscribe, escalateOrFail]);

  beginRecoveryRef.current = beginRecovery;

  /**
   * Call once notifications are subscribed on a fresh (or recovered)
   * connection.
   *
   * @param {object} [options]
   * @param {boolean} [options.isAutomaticRecovery] - true ONLY when this
   *   call is the direct result of this hook's own onReconnectNeeded
   *   escalation succeeding. Leaves the recovery budget (attemptRef) and
   *   'failed' status untouched, since a radio-level reconnect that still
   *   isn't producing real BPM data is not a recovery. Every other caller -
   *   the app's initial silent reconnect, a user pressing Connect/Reconnect,
   *   switching devices - is an explicit/manual attempt and gets a full
   *   fresh budget, including a way out of 'failed'.
   */
  const startMonitoring = useCallback((connection, { isAutomaticRecovery = false } = {}) => {
    connectionRef.current = connection;
    activeRef.current = true;
    recoveryInProgressRef.current = false;
    if (!isAutomaticRecovery) {
      attemptRef.current = 0;
      failedRef.current = false;
    }
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
   * watchdog tick. Never restarts automatic recovery once the budget is
   * already exhausted ('failed') - that requires an explicit reconnect.
   */
  const checkHealthOnResume = useCallback(() => {
    if (!activeRef.current || recoveryInProgressRef.current || failedRef.current) return;
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
