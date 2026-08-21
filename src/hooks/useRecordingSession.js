import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import sessionRecorder from '../services/session';
import debugRecorder from '../utils/debugBluetooth';
import { analyzeHRV } from '../utils/hrvCalculations';

const EMPTY_RECORDING_STATS = { average: 0, min: 0, max: 0, count: 0 };
const HRV_TEST_DURATION = 120000; // 2 minutes

/**
 * Everything about an active heart-rate session that's identical on web and
 * Android: live BPM, the Start/Stop Recording lifecycle (persisted via
 * services/session, IndexedDB or native SQLite depending on platform), the
 * live chart's reading buffer, and HRV testing. What differs between
 * platforms - how a BLE connection is actually established (explicit
 * Connect button on web vs. auto-reconnect on Android) - stays owned by
 * each platform's own top-level component, which feeds readings into
 * `processReading` however it obtains them. `deviceName` is passed to
 * startRecording() at call time (rather than as a hook parameter) so this
 * hook has no dependency on how/when each platform's connection state
 * becomes known.
 */
export function useRecordingSession() {
  const [currentHR, setCurrentHR] = useState(0);

  const [sessionType, setSessionType] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [recordingStats, setRecordingStats] = useState(EMPTY_RECORDING_STATS);
  const [chartReadings, setChartReadings] = useState([]);
  const isRecordingRef = useRef(false);
  const recordingStartTimeRef = useRef(null);
  const currentSessionIdRef = useRef(null);

  const [isHRVTesting, setIsHRVTesting] = useState(false);
  const [hrvTestStart, setHRVTestStart] = useState(null);
  const [hrvReadings, setHRVReadings] = useState([]);
  const [hrvResults, setHRVResults] = useState(null);
  const hrvReadingsRef = useRef([]);

  // A session left in 'recording' status means the app/tab was killed mid-recording
  // (web: closed tab; Android: process killed - the native layer already finalizes
  // that case itself, but this covers the same check on web). Close it out as
  // 'interrupted' rather than leaving it stuck or losing the readings.
  useEffect(() => {
    sessionRecorder.recoverInterruptedSessions().catch((err) => {
      console.error('Failed to recover interrupted session:', err);
    });
  }, []);

  const resetCurrentHR = useCallback(() => setCurrentHR(0), []);

  /** Single entry point for every incoming heart-rate reading, live device or debug playback. */
  const processReading = useCallback((data) => {
    debugRecorder.recordReading(data);
    setCurrentHR(data.heartRate);

    if (isRecordingRef.current && currentSessionIdRef.current) {
      sessionRecorder.recordReading(currentSessionIdRef.current, {
        heartRate: data.heartRate,
        rrIntervals: data.rrIntervals
      });

      if (recordingStartTimeRef.current) {
        const elapsedMs = Date.now() - recordingStartTimeRef.current.getTime();
        setChartReadings((prev) => [...prev, { elapsedMs, heartRate: data.heartRate }]);
      }
    }

    if (data.rrIntervals && data.rrIntervals.length > 0) {
      setHRVReadings((prev) => {
        const next = [...prev, data];
        hrvReadingsRef.current = next;
        return next;
      });
    }
  }, []);

  /** Finalize the active recording (if any) with the given status - a clean
   * 'completed' Stop Recording press vs. an 'interrupted' disconnect. */
  const abortRecording = useCallback(async (status) => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);

    const sessionId = currentSessionIdRef.current;
    currentSessionIdRef.current = null;
    if (!sessionId) return;

    try {
      await sessionRecorder.stopRecording(sessionId, status);
    } catch (err) {
      console.error('Failed to finalize recording:', err);
    }
  }, []);

  const startRecording = useCallback(async (deviceName) => {
    if (!sessionType) return;

    recordingStartTimeRef.current = new Date();
    isRecordingRef.current = true;
    setIsRecording(true);
    setRecordingElapsedMs(0);
    setRecordingStats(EMPTY_RECORDING_STATS);
    setChartReadings([]);

    try {
      currentSessionIdRef.current = await sessionRecorder.startRecording(
        { deviceName, sessionType },
        (stats) => setRecordingStats(stats)
      );
    } catch (err) {
      isRecordingRef.current = false;
      setIsRecording(false);
      throw err;
    }
  }, [sessionType]);

  const stopRecording = useCallback(() => abortRecording('completed'), [abortRecording]);

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
  // (a harmless no-op in the Android WebView, which doesn't fire beforeunload the same way)
  useEffect(() => {
    if (!isRecording) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRecording]);

  // HRV Test Handlers
  const startHRVTest = useCallback(() => {
    setIsHRVTesting(true);
    setHRVTestStart(Date.now());
    setHRVReadings([]);
    hrvReadingsRef.current = [];
    setHRVResults(null);
  }, []);

  const stopHRVTest = useCallback(() => {
    const results = analyzeHRV(hrvReadingsRef.current);
    setHRVResults(results);
    setIsHRVTesting(false);
  }, []);

  useEffect(() => {
    if (!isHRVTesting) return;
    const timer = setTimeout(() => stopHRVTest(), HRV_TEST_DURATION);
    return () => clearTimeout(timer);
  }, [isHRVTesting, stopHRVTest]);

  const hrvTestState = useMemo(() => {
    if (!isHRVTesting) {
      return { isRunning: false, duration: 0, elapsed: 0, rrCount: 0 };
    }
    const elapsed = Date.now() - hrvTestStart;
    const rrCount = hrvReadings.flatMap((r) => r.rrIntervals || []).length;
    return { isRunning: true, duration: HRV_TEST_DURATION, elapsed, rrCount };
  }, [isHRVTesting, hrvTestStart, hrvReadings]);

  return {
    currentHR,
    resetCurrentHR,
    processReading,

    sessionType,
    setSessionType,
    isRecording,
    recordingElapsedMs,
    recordingStats,
    chartReadings,
    startRecording,
    stopRecording,
    abortRecording,

    isHRVTesting,
    hrvTestState,
    hrvResults,
    startHRVTest,
    stopHRVTest
  };
}
