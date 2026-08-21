import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import ConnectionButton from './ConnectionButton';
import HRDisplay from './HRDisplay';
import RecordingPanel from './RecordingPanel';
import SessionTypeSelector from './SessionTypeSelector';
import Stats from './Stats';
import HRVAnalysis from './HRVAnalysis';
import {
  connectToHeartRateMonitor,
  startHeartRateNotifications,
  stopHeartRateNotifications,
  disconnectDevice,
  readBatteryLevel,
  readDeviceInformation,
  readBodySensorLocation
} from '../utils/bluetooth';
import debugRecorder from '../utils/debugBluetooth';
import { analyzeHRV } from '../utils/hrvCalculations';
import { buildCSV, buildRecordingFilename, downloadCSV } from '../utils/csvExport';

const EMPTY_RECORDING_STATS = { average: 0, min: 0, max: 0, count: 0 };

function HRMonitor() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentHR, setCurrentHR] = useState(0);
  const [deviceName, setDeviceName] = useState('');
  const [batteryLevel, setBatteryLevel] = useState(null);
  const [deviceInfo, setDeviceInfo] = useState({});
  const [sensorLocation, setSensorLocation] = useState(null);
  const [error, setError] = useState('');
  const [server, setServer] = useState(null);
  const [characteristic, setCharacteristic] = useState(null);
  const isPlaybackMode = useRef(false);

  // Session type ('strength' | 'cardio') must be chosen before recording starts.
  // It persists across recordings for convenience; only locked while actively recording.
  const [sessionType, setSessionType] = useState(null);

  // Recording state - drives the Start Recording / Stop & Download CSV workflow.
  // The debugRecorder singleton is reused as the underlying storage engine.
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [recordingStats, setRecordingStats] = useState(EMPTY_RECORDING_STATS);
  const isRecordingRef = useRef(false);
  const recordingStartTimeRef = useRef(null);
  // Running totals so per-reading stats update in O(1) without storing every reading twice.
  const recordingStatsAccumulatorRef = useRef({ sum: 0, count: 0, min: Infinity, max: -Infinity });

  // HRV test state
  const [isHRVTesting, setIsHRVTesting] = useState(false);
  const [hrvTestStart, setHRVTestStart] = useState(null);
  const [hrvReadings, setHRVReadings] = useState([]);
  const [hrvResults, setHRVResults] = useState(null);
  const hrvReadingsRef = useRef([]);

  const HRV_TEST_DURATION = 120000; // 2 minutes in milliseconds

  // Single entry point for every incoming heart-rate reading, whether from a live
  // device or debug playback. Fans the reading out to the debug recorder (the CSV
  // storage engine), the live BPM display, the active recording's running stats,
  // and HRV collection.
  const processReading = useCallback((data) => {
    debugRecorder.recordReading(data);
    setCurrentHR(data.heartRate);

    if (isRecordingRef.current) {
      const acc = recordingStatsAccumulatorRef.current;
      acc.sum += data.heartRate;
      acc.count += 1;
      acc.min = Math.min(acc.min, data.heartRate);
      acc.max = Math.max(acc.max, data.heartRate);
      setRecordingStats({
        average: Math.round(acc.sum / acc.count),
        min: acc.min,
        max: acc.max,
        count: acc.count
      });
    }

    if (data.rrIntervals && data.rrIntervals.length > 0) {
      setHRVReadings(prev => {
        const newReadings = [...prev, data];
        hrvReadingsRef.current = newReadings; // Keep ref in sync
        return newReadings;
      });
    }
  }, []);

  // Register playback callbacks with debug system
  useEffect(() => {
    // Register UI integration callbacks with hrDebug
    debugRecorder.registerUICallbacks({
      onStart: async (sessionData) => {
        // Set up playback mode
        isPlaybackMode.current = true;
        setDeviceName(sessionData.deviceName + ' (Playback)');
        setIsConnected(true);
        setCurrentHR(0);
        setHRVReadings([]);
        setError('');
      },
      onReading: processReading,
      onComplete: () => {
        // Playback end callback
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
  }, [processReading]);

  // Handle disconnection events
  useEffect(() => {
    if (!server) return;

    const handleDisconnect = () => {
      setIsConnected(false);
      setCurrentHR(0);
      setDeviceName('');
      setError('Device disconnected');
    };

    server.device.addEventListener('gattserverdisconnected', handleDisconnect);

    return () => {
      server.device.removeEventListener('gattserverdisconnected', handleDisconnect);
    };
  }, [server]);

  // Periodic battery level polling (every 60 seconds)
  useEffect(() => {
    if (!server || !isConnected || isPlaybackMode.current) return;

    const pollBattery = async () => {
      const battery = await readBatteryLevel(server);
      if (battery !== null) {
        setBatteryLevel(battery);
      }
    };

    // Poll immediately, then every 60 seconds
    pollBattery();
    const interval = setInterval(pollBattery, 60000);

    return () => clearInterval(interval);
  }, [server, isConnected]);

  // Tick the elapsed recording timer once per second while recording is active
  useEffect(() => {
    if (!isRecording) return;

    const tick = () => {
      if (recordingStartTimeRef.current) {
        setRecordingElapsedMs(Date.now() - recordingStartTimeRef.current.getTime());
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  // Warn before an accidental tab close/refresh while a recording is in progress
  useEffect(() => {
    if (!isRecording) return;

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRecording]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setError('');

    try {
      // Connect to device
      const gattServer = await connectToHeartRateMonitor();
      setServer(gattServer);
      const deviceNameStr = gattServer.device.name || 'Unknown Device';
      setDeviceName(deviceNameStr);

      // Set connected device for debug recorder
      debugRecorder.setConnectedDevice(deviceNameStr);

      // Read initial battery level
      const battery = await readBatteryLevel(gattServer);
      setBatteryLevel(battery);

      // Read device information and sensor location
      const devInfo = await readDeviceInformation(gattServer);
      setDeviceInfo(devInfo);

      const location = await readBodySensorLocation(gattServer);
      setSensorLocation(location);

      // Start receiving heart rate data
      const char = await startHeartRateNotifications(gattServer, processReading);

      setCharacteristic(char);
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
      if (isRecordingRef.current) {
        // Preserve whatever was captured rather than silently discarding it
        finishRecording({ download: true });
      } else if (debugRecorder.getStatus().isRecording) {
        // A recording was started via the console debug API, not our UI - just stop it
        debugRecorder.stopRecording();
      }

      // Stop playback if active
      if (isPlaybackMode.current) {
        debugRecorder.stopPlayback();
        isPlaybackMode.current = false;
      } else {
        // Only disconnect real device if not in playback mode
        if (characteristic) {
          await stopHeartRateNotifications(characteristic);
        }
        if (server) {
          disconnectDevice(server);
        }
      }

      setIsConnected(false);
      setCurrentHR(0);
      setDeviceName('');
      setBatteryLevel(null);
      setDeviceInfo({});
      setSensorLocation(null);
      setServer(null);
      setCharacteristic(null);
      setRecordingElapsedMs(0);
      setRecordingStats(EMPTY_RECORDING_STATS);

      // Clear connected device from debug recorder
      debugRecorder.setConnectedDevice('');
    } catch (err) {
      setError('Error disconnecting: ' + err.message);
    }
  };

  // Recording Handlers
  const handleStartRecording = () => {
    if (!sessionType) return;

    recordingStartTimeRef.current = new Date();
    recordingStatsAccumulatorRef.current = { sum: 0, count: 0, min: Infinity, max: -Infinity };
    isRecordingRef.current = true;
    setIsRecording(true);
    setRecordingElapsedMs(0);
    setRecordingStats(EMPTY_RECORDING_STATS);
    debugRecorder.startRecording(deviceName, sessionType);
  };

  const finishRecording = ({ download }) => {
    isRecordingRef.current = false;
    setIsRecording(false);
    const sessionData = debugRecorder.stopRecording();

    if (download && sessionData && sessionData.readings.length > 0 && recordingStartTimeRef.current) {
      const csv = buildCSV(sessionData.readings, recordingStartTimeRef.current, sessionData.sessionType);
      const filename = buildRecordingFilename(recordingStartTimeRef.current, sessionData.sessionType);
      downloadCSV(csv, filename);
    }
  };

  const handleStopRecording = () => {
    finishRecording({ download: true });
  };

  // HRV Test Handlers
  const handleStartHRVTest = () => {
    setIsHRVTesting(true);
    setHRVTestStart(Date.now());
    setHRVReadings([]);
    hrvReadingsRef.current = [];
    setHRVResults(null);
  };

  const handleStopHRVTest = useCallback(() => {
    // Use ref to get latest readings without causing re-renders
    const results = analyzeHRV(hrvReadingsRef.current);
    setHRVResults(results);
    setIsHRVTesting(false);
  }, []);

  // Auto-stop HRV test after duration
  useEffect(() => {
    if (!isHRVTesting) return;

    const timer = setTimeout(() => {
      handleStopHRVTest();
    }, HRV_TEST_DURATION);

    return () => clearTimeout(timer);
  }, [isHRVTesting, handleStopHRVTest]);

  // Calculate HRV test state for component
  const hrvTestState = useMemo(() => {
    if (!isHRVTesting) {
      return { isRunning: false, duration: 0, elapsed: 0, rrCount: 0 };
    }

    const elapsed = Date.now() - hrvTestStart;
    const rrCount = hrvReadings.flatMap(r => r.rrIntervals || []).length;

    return {
      isRunning: true,
      duration: HRV_TEST_DURATION,
      elapsed,
      rrCount
    };
  }, [isHRVTesting, hrvTestStart, hrvReadings]);

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
        />

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        {isConnected && (
          <>
            <HRDisplay currentHR={currentHR} />

            <SessionTypeSelector
              sessionType={sessionType}
              onChange={setSessionType}
              disabled={isRecording}
            />

            <RecordingPanel
              isRecording={isRecording}
              elapsedMs={recordingElapsedMs}
              startDisabled={!sessionType}
              onStart={handleStartRecording}
              onStop={handleStopRecording}
            />

            {isRecording && (
              <Stats stats={recordingStats} readingsCount={recordingStats.count} />
            )}

            <details className="hrv-details">
              <summary className="hrv-summary">HRV Analysis (optional)</summary>
              <HRVAnalysis
                isConnected={isConnected}
                testState={hrvTestState}
                results={hrvResults}
                onStartTest={handleStartHRVTest}
                onStopTest={handleStopHRVTest}
              />
            </details>
          </>
        )}

        {!isConnected && !error && (
          <div className="info-message">
            <p>Make sure your heart rate monitor is turned on and in pairing mode</p>
            <p>This app requires a browser with Web Bluetooth support (Chrome or Edge)</p>
            <p>Linux users: Enable Web Bluetooth at <code>chrome://flags#enable-experimental-web-platform-features</code></p>
          </div>
        )}
      </main>

      <footer className="footer">
        <p>© 2025. Licensed under MIT.</p>
      </footer>
    </div>
  );
}

export default HRMonitor;
