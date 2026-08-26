import React, { useState, useEffect, useRef, useCallback } from 'react';
import ConnectionButton from './ConnectionButton';
import HRDisplay from './HRDisplay';
import RecordingPanel from './RecordingPanel';
import SessionTypeSelector from './SessionTypeSelector';
import TreadmillSpeedControl from './TreadmillSpeedControl';
import Stats from './Stats';
import HRVAnalysis from './HRVAnalysis';
import bluetooth from '../services/bluetooth';
import { isNativePlatform } from '../services/platform';
import debugRecorder from '../utils/debugBluetooth';
import { useRecordingSession } from '../hooks/useRecordingSession';
import { useHeartRateStreamHealth } from '../hooks/useHeartRateStreamHealth';
import { useAppForegroundResume } from '../hooks/useAppForegroundResume';

const STREAM_STATUS_LABEL = {
  'waiting-for-data': 'Waiting for signal…',
  recovering: 'Reconnecting…',
  failed: 'Lost signal'
};

function HRMonitor({ onOpenHistory, onOpenDashboard }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [batteryLevel, setBatteryLevel] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState({});
  const [sensorLocation, setSensorLocation] = useState(null);
  const [error, setError] = useState('');
  const connectionRef = useRef(null);
  const unsubscribeDisconnectRef = useRef(null);
  const isPlaybackMode = useRef(false);
  const fullReconnectInProgressRef = useRef(false);

  const session = useRecordingSession();

  const handleUnexpectedDisconnect = useCallback(() => {
    stream.stopMonitoring();
    session.abortRecording('interrupted');
    connectionRef.current = null;
    setIsConnected(false);
    session.resetCurrentHR();
    setDeviceName('');
    setError('Device disconnected');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Web Bluetooth can't silently reconnect without a user gesture, so a
  // full reconnect here can only clean up and ask the user to reconnect -
  // resubscribing on the existing connection (no user gesture needed) is
  // tried first and covers the common "still paired, notifications just
  // stopped" case.
  const handleReconnectNeeded = useCallback(async () => {
    if (fullReconnectInProgressRef.current || isPlaybackMode.current) return;
    fullReconnectInProgressRef.current = true;
    try {
      if (unsubscribeDisconnectRef.current) {
        unsubscribeDisconnectRef.current();
        unsubscribeDisconnectRef.current = null;
      }
      if (connectionRef.current) {
        try {
          await bluetooth.disconnect(connectionRef.current);
        } catch {
          // Best-effort - the link may already be down.
        }
      }
      connectionRef.current = null;
      setIsConnected(false);
      setError('Lost the heart rate signal - reconnect to continue');
    } finally {
      fullReconnectInProgressRef.current = false;
    }
  }, []);

  const stream = useHeartRateStreamHealth({
    onReading: session.processReading,
    onReconnectNeeded: handleReconnectNeeded
  });

  useAppForegroundResume(() => {
    if (isConnected && !isPlaybackMode.current) stream.checkHealthOnResume();
  });

  // Register playback callbacks with debug system
  useEffect(() => {
    debugRecorder.registerUICallbacks({
      onStart: async (sessionData) => {
        isPlaybackMode.current = true;
        setDeviceName(sessionData.deviceName + ' (Playback)');
        setIsConnected(true);
        session.resetCurrentHR();
        setError('');
      },
      onReading: session.processReading,
      onComplete: () => {
        console.log('📊 Playback completed');
        setDeviceName(prev => prev + ' - Completed');
      },
      onStop: () => {
        handleDisconnect();
      },
      onError: (error) => {
        setError('Failed to load recording: ' + error.message);
        console.error('Playback error:', error);
      }
    });

    return () => {
      debugRecorder.unregisterUICallbacks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.processReading]);

  // Periodic battery level polling (every 60 seconds)
  useEffect(() => {
    if (!isConnected || isPlaybackMode.current) return;

    const pollBattery = async () => {
      const battery = await bluetooth.readBatteryLevel(connectionRef.current);
      if (battery !== null) {
        setBatteryLevel(battery);
      }
    };

    pollBattery();
    const interval = setInterval(pollBattery, 60000);

    return () => clearInterval(interval);
  }, [isConnected]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setError('');

    try {
      const connection = await bluetooth.connect();
      connectionRef.current = connection;
      setDeviceName(connection.deviceName);
      debugRecorder.setConnectedDevice(connection.deviceName);

      const battery = await bluetooth.readBatteryLevel(connection);
      setBatteryLevel(battery);

      const devInfo = await bluetooth.readDeviceInformation(connection);
      setDeviceInfo(devInfo);

      const location = await bluetooth.readBodySensorLocation(connection);
      setSensorLocation(location);

      const activeConnection = await bluetooth.startNotifications(connection, stream.handleReading);
      connectionRef.current = activeConnection;
      stream.startMonitoring(activeConnection);

      unsubscribeDisconnectRef.current = bluetooth.onUnexpectedDisconnect(
        activeConnection,
        handleUnexpectedDisconnect
      );

      setIsConnected(true);
    } catch (err) {
      setError(err.message || 'Failed to connect to heart rate monitor');
      console.error('Connection error:', err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      stream.stopMonitoring();
      if (unsubscribeDisconnectRef.current) {
        unsubscribeDisconnectRef.current();
        unsubscribeDisconnectRef.current = null;
      }

      // The recording can't continue without the device - preserve whatever
      // was captured as 'interrupted' rather than silently discarding it.
      await session.abortRecording('interrupted');

      if (isPlaybackMode.current) {
        debugRecorder.stopPlayback();
        isPlaybackMode.current = false;
      } else {
        await bluetooth.stopNotifications(connectionRef.current);
        await bluetooth.disconnect(connectionRef.current);
      }

      connectionRef.current = null;
      setIsConnected(false);
      session.resetCurrentHR();
      setDeviceName('');
      setBatteryLevel(null);
      setDeviceInfo({});
      setSensorLocation(null);

      debugRecorder.setConnectedDevice('');
    } catch (err) {
      setError('Error disconnecting: ' + err.message);
    }
  };

  const handleStartRecording = async () => {
    try {
      await session.startRecording(deviceName);
    } catch (err) {
      setError('Failed to start recording: ' + err.message);
    }
  };

  const bluetoothUnsupported = !isNativePlatform() && !bluetooth.isSupported();

  return (
    <div className="hr-monitor">
      <header className="header">
        <h1>Heart Rate Monitor</h1>
      </header>

      <main className="main-content">
        <ConnectionButton
          isConnected={isConnected}
          isConnecting={isConnecting}
          deviceName={deviceName}
          batteryLevel={batteryLevel}
          deviceInfo={deviceInfo}
          sensorLocation={sensorLocation}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          connectDisabled={bluetoothUnsupported}
        />

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {bluetoothUnsupported && (
          <div className="error-message">
            Web Bluetooth isn't available in this browser. Use Chrome or Edge on desktop/Android.
          </div>
        )}

        {isConnected && (
          <>
            {STREAM_STATUS_LABEL[stream.streamState] && (
              <div className="stream-status-message">{STREAM_STATUS_LABEL[stream.streamState]}</div>
            )}
            <HRDisplay currentHR={session.currentHR} />

            <SessionTypeSelector
              sessionType={session.sessionType}
              onChange={session.setSessionType}
              disabled={session.isRecording}
            />

            {session.sessionType === 'cardio' && (
              <TreadmillSpeedControl
                value={session.treadmillSpeedValue}
                unit={session.treadmillSpeedUnit}
                onValueChange={session.setTreadmillSpeed}
                onUnitChange={session.setTreadmillSpeedUnit}
              />
            )}

            <RecordingPanel
              isRecording={session.isRecording}
              elapsedMs={session.recordingElapsedMs}
              startDisabled={!session.sessionType}
              onStart={handleStartRecording}
              onStop={session.stopRecording}
            />

            {session.isRecording && (
              <Stats stats={session.recordingStats} readingsCount={session.recordingStats.count} />
            )}

            <details className="hrv-details">
              <summary className="hrv-summary">HRV Analysis (optional)</summary>
              <HRVAnalysis
                isConnected={isConnected}
                testState={session.hrvTestState}
                results={session.hrvResults}
                onStartTest={session.startHRVTest}
                onStopTest={session.stopHRVTest}
              />
            </details>
          </>
        )}

        {!isConnected && !error && !bluetoothUnsupported && (
          <div className="info-message">
            <p>Make sure your heart rate monitor is turned on and in pairing mode</p>
            <p>This app requires a browser with Web Bluetooth support (Chrome or Edge)</p>
            <p>Linux users: Enable Web Bluetooth at <code>chrome://flags#enable-experimental-web-platform-features</code></p>
          </div>
        )}

        <button className="btn-secondary history-link-btn" onClick={onOpenHistory}>
          View History
        </button>
        <button className="btn-secondary history-link-btn" onClick={onOpenDashboard}>
          Dashboard
        </button>
      </main>

      <footer className="footer">
        <p>© 2025. Licensed under MIT.</p>
      </footer>
    </div>
  );
}

export default HRMonitor;
