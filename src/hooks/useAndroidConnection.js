import { useState, useRef, useCallback, useEffect } from 'react';
import bluetooth from '../services/bluetooth';
import debugRecorder from '../utils/debugBluetooth';

/**
 * Owns Android's connection lifecycle: attempts a silent reconnect to the
 * last-used device on mount instead of leading with a Connect button, and
 * exposes the secondary device-management actions (connect a new device,
 * manually reconnect, forget). `onReading` feeds into whatever recording
 * session logic the caller is running (see useRecordingSession);
 * `onDisconnected` lets the caller abort/finalize an active recording.
 *
 * connectionState: 'no_device' | 'not_connected' | 'connecting' | 'connected'
 */
export function useAndroidConnection({ onReading, onDisconnected }) {
  const [connectionState, setConnectionState] = useState('no_device');
  const [deviceName, setDeviceName] = useState('');
  const [batteryLevel, setBatteryLevel] = useState(null);
  const [error, setError] = useState('');
  const connectionRef = useRef(null);
  const unsubscribeDisconnectRef = useRef(null);

  const handleUnexpectedDisconnect = useCallback(() => {
    connectionRef.current = null;
    setConnectionState('not_connected');
    setBatteryLevel(null);
    onDisconnected?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wireUpConnection = useCallback(async (connection, name) => {
    connectionRef.current = connection;
    debugRecorder.setConnectedDevice(name);

    const activeConnection = await bluetooth.startNotifications(connection, onReading);
    connectionRef.current = activeConnection;

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
  }, [onReading, handleUnexpectedDisconnect]);

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
    reconnect: attemptReconnect,
    connectNewDevice,
    disconnect,
    forgetDevice
  };
}
