import { useState, useRef, useCallback, useEffect } from 'react';
import bluetooth from '../services/bluetooth';
import debugRecorder from '../utils/debugBluetooth';
import { useHeartRateStreamHealth } from './useHeartRateStreamHealth';
import { useAppForegroundResume } from './useAppForegroundResume';

/**
 * Owns Android's connection lifecycle: attempts a silent reconnect to the
 * last-used device on mount instead of leading with a Connect button, and
 * exposes the secondary device-management actions (connect a new device,
 * manually reconnect, forget). `onReading` feeds into whatever recording
 * session logic the caller is running (see useRecordingSession);
 * `onDisconnected` lets the caller abort/finalize an active recording.
 *
 * connectionState: 'no_device' | 'not_connected' | 'connecting' | 'connected'
 *   (BLE-link state - whether the radio link is up)
 * streamState: 'disconnected' | 'waiting-for-data' | 'streaming' | 'recovering' | 'failed'
 *   (HR-notification health - whether BPM data is actually arriving; see
 *   useHeartRateStreamHealth. A device can be 'connected' while its stream
 *   sits in 'waiting-for-data'/'recovering' - that's exactly the "connected
 *   but -- BPM" bug this distinction exists to catch and recover from.)
 *
 * Recovery (resubscribe, then bounded reconnect-with-backoff) never touches
 * an in-progress recording: it only ever re-subscribes the same `onReading`
 * callback, it never calls startRecording again.
 */
export function useAndroidConnection({ onReading, onDisconnected }) {
  const [connectionState, setConnectionState] = useState('no_device');
  const [deviceName, setDeviceName] = useState('');
  const [batteryLevel, setBatteryLevel] = useState(null);
  const [error, setError] = useState('');
  const connectionRef = useRef(null);
  const unsubscribeDisconnectRef = useRef(null);
  const deviceNameRef = useRef('');
  const fullReconnectInProgressRef = useRef(false);

  const handleUnexpectedDisconnect = useCallback(() => {
    stream.stopMonitoring();
    connectionRef.current = null;
    setConnectionState('not_connected');
    setBatteryLevel(null);
    onDisconnected?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The stream watchdog has given up on resubscribing and asked for a full
   * reconnect. Tear down the stale link and reconnect to the same
   * (remembered) device, then resubscribe on the fresh connection - all
   * without touching connectionState in a way that would suggest to the
   * recording hook that it should stop (an active recording just keeps
   * accumulating whatever the reading callback delivers, gap and all).
   */
  const handleReconnectNeeded = useCallback(async () => {
    if (fullReconnectInProgressRef.current) return;
    fullReconnectInProgressRef.current = true;
    try {
      const staleConnection = connectionRef.current;
      if (staleConnection) {
        try {
          await bluetooth.disconnect(staleConnection);
        } catch {
          // Best-effort - the link may already be down.
        }
      }
      connectionRef.current = null;

      const result = await bluetooth.autoReconnect();
      if (result.connected) {
        const connection = { deviceId: result.deviceId, deviceName: result.deviceName || deviceNameRef.current };
        // isAutomaticRecovery: true - a radio-level reconnect succeeding here
        // does NOT by itself mean the stream is healthy again, so it must not
        // reset the bounded recovery budget (see useHeartRateStreamHealth).
        // eslint-disable-next-line no-use-before-define
        await wireUpConnection(connection, connection.deviceName, { isAutomaticRecovery: true });
      } else {
        setConnectionState('not_connected');
      }
    } catch (err) {
      console.error('Recovery reconnect failed:', err);
      setConnectionState('not_connected');
    } finally {
      fullReconnectInProgressRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stream = useHeartRateStreamHealth({ onReading, onReconnectNeeded: handleReconnectNeeded });

  const wireUpConnection = useCallback(async (connection, name, { isAutomaticRecovery = false } = {}) => {
    connectionRef.current = connection;
    deviceNameRef.current = name;
    debugRecorder.setConnectedDevice(name);

    const activeConnection = await bluetooth.startNotifications(connection, stream.handleReading);
    connectionRef.current = activeConnection;
    stream.startMonitoring(activeConnection, { isAutomaticRecovery });

    unsubscribeDisconnectRef.current = bluetooth.onUnexpectedDisconnect(
      activeConnection,
      handleUnexpectedDisconnect
    );

    // Mark connected immediately - a slow/failed battery read must never
    // block the status transition (it's a secondary detail, not a
    // precondition for "connected").
    setConnectionState('connected');
    bluetooth.readBatteryLevel(activeConnection).then((battery) => {
      if (battery !== null) setBatteryLevel(battery);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.handleReading, stream.startMonitoring, handleUnexpectedDisconnect]);

  const attemptReconnect = useCallback(async () => {
    const remembered = await bluetooth.getRememberedDevice();
    if (!remembered) {
      setConnectionState('no_device');
      return;
    }

    setDeviceName(remembered.deviceName);
    setConnectionState('connecting');
    setError('');

    try {
      const result = await bluetooth.autoReconnect();
      if (result.connected) {
        setDeviceName(result.deviceName || remembered.deviceName);
        await wireUpConnection({ deviceId: result.deviceId, deviceName: result.deviceName }, result.deviceName);
      } else {
        setConnectionState('not_connected');
      }
    } catch (err) {
      console.error('Auto-reconnect failed:', err);
      setConnectionState('not_connected');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wireUpConnection]);

  // Attempt a silent reconnect once, on first mount.
  useEffect(() => {
    attemptReconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic battery level polling while connected
  useEffect(() => {
    if (connectionState !== 'connected') return;
    const pollBattery = async () => {
      const battery = await bluetooth.readBatteryLevel(connectionRef.current);
      if (battery !== null) setBatteryLevel(battery);
    };
    const interval = setInterval(pollBattery, 60000);
    return () => clearInterval(interval);
  }, [connectionState]);

  // On app foreground-resume, check the stream (not just the link) is
  // actually still healthy. A healthy, recently-updated stream is left
  // completely alone - we must never reconnect a stream that's fine just
  // because the app happened to resume.
  useAppForegroundResume(() => {
    if (connectionState === 'connected') stream.checkHealthOnResume();
  });

  /** Scan for and connect to a device (new or previously used) - remembers it for next launch. */
  const connectNewDevice = useCallback(async () => {
    setConnectionState('connecting');
    setError('');
    try {
      const connection = await bluetooth.connect();
      setDeviceName(connection.deviceName);
      await wireUpConnection(connection, connection.deviceName);
    } catch (err) {
      setError(err.message || 'Failed to connect to heart rate monitor');
      setConnectionState((prev) => (prev === 'connecting' ? 'not_connected' : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wireUpConnection]);

  const disconnect = useCallback(async () => {
    stream.stopMonitoring();
    if (unsubscribeDisconnectRef.current) {
      unsubscribeDisconnectRef.current();
      unsubscribeDisconnectRef.current = null;
    }
    if (connectionRef.current) {
      await bluetooth.stopNotifications(connectionRef.current);
      await bluetooth.disconnect(connectionRef.current);
      connectionRef.current = null;
    }
    setBatteryLevel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forgetDevice = useCallback(async () => {
    await disconnect();
    await bluetooth.forgetDevice();
    setDeviceName('');
    setConnectionState('no_device');
  }, [disconnect]);

  return {
    connectionState,
    deviceName,
    batteryLevel,
    error,
    isConnected: connectionState === 'connected',
    streamState: stream.streamState,
    lastHeartRateReceivedAt: stream.lastHeartRateReceivedAt,
    reconnect: attemptReconnect,
    connectNewDevice,
    disconnect,
    forgetDevice
  };
}
