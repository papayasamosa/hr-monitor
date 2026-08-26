import React from 'react';
import HeartRateChart from '../HeartRateChart';
import HRVAnalysis from '../HRVAnalysis';
import TreadmillSpeedControl from '../TreadmillSpeedControl';

const SESSION_TYPES = [
  { value: 'strength', label: 'Strength' },
  { value: 'cardio', label: 'Cardio' }
];

const STATUS_LABEL = {
  connected: 'Connected',
  connecting: 'Connecting…',
  not_connected: 'Not connected',
  no_device: 'No HR monitor configured'
};

const STREAM_STATUS_LABEL = {
  'waiting-for-data': 'Waiting for signal…',
  recovering: 'Reconnecting…',
  failed: 'Lost signal'
};

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function AndroidHome({ session, connection, onOpenHistory, onOpenDeviceSettings, onOpenDashboard }) {
  const handleStartRecording = async () => {
    try {
      await session.startRecording(connection.deviceName);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  };

  return (
    <div className="android-home">
      <header className="android-header">
        <h1>Heart Rate Monitor</h1>
      </header>

      <main className="android-main">
        <button className="android-device-row" onClick={onOpenDeviceSettings}>
          <span className={`android-status-dot status-${connection.connectionState}`} />
          <span className="android-device-info">
            <span className="android-status-label">{STATUS_LABEL[connection.connectionState]}</span>
            {connection.deviceName && <span className="android-device-name">{connection.deviceName}</span>}
          </span>
          {connection.isConnected && connection.batteryLevel !== null && (
            <span className="android-battery">{connection.batteryLevel}%</span>
          )}
          <span className="android-chevron">&rsaquo;</span>
        </button>

        {connection.error && <div className="error-message">{connection.error}</div>}

        {connection.isConnected && STREAM_STATUS_LABEL[connection.streamState] && (
          <div className="android-stream-status">{STREAM_STATUS_LABEL[connection.streamState]}</div>
        )}

        <div className="android-bpm-display">
          <div className="android-bpm-value">{session.currentHR || '--'}</div>
          <div className="android-bpm-unit">BPM</div>
        </div>

        {session.isRecording && (
          <div className="android-recording-timer">{formatElapsed(session.recordingElapsedMs)}</div>
        )}

        {!session.isRecording && (
          <div className="android-session-type">
            <div className="android-session-type-label">Session type</div>
            <div className="android-session-type-pills">
              {SESSION_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`android-pill ${session.sessionType === value ? 'selected' : ''}`}
                  onClick={() => session.setSessionType(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {session.sessionType === 'cardio' && (
          <TreadmillSpeedControl
            value={session.treadmillSpeedValue}
            unit={session.treadmillSpeedUnit}
            onValueChange={session.setTreadmillSpeed}
            onUnitChange={session.setTreadmillSpeedUnit}
          />
        )}

        {session.isRecording && (
          <div className="android-stats-row">
            <div className="android-stat">
              <span className="android-stat-value">{session.recordingStats.average}</span>
              <span className="android-stat-label">Average</span>
            </div>
            <div className="android-stat">
              <span className="android-stat-value">{session.recordingStats.min}</span>
              <span className="android-stat-label">Min</span>
            </div>
            <div className="android-stat">
              <span className="android-stat-value">{session.recordingStats.max}</span>
              <span className="android-stat-label">Max</span>
            </div>
          </div>
        )}

        {session.isRecording && (
          <div className="android-reading-count">{session.recordingStats.count.toLocaleString()} readings</div>
        )}

        {!session.isRecording ? (
          <button
            className="android-primary-btn"
            onClick={handleStartRecording}
            disabled={!session.sessionType || !connection.isConnected}
          >
            Start Recording
          </button>
        ) : (
          <button className="android-primary-btn android-stop-btn" onClick={session.stopRecording}>
            Stop Recording
          </button>
        )}

        {!session.isRecording && !connection.isConnected && (
          <p className="android-hint">Connect a heart rate monitor to start recording</p>
        )}

        {session.isRecording && <HeartRateChart readings={session.chartReadings} />}

        <button className="android-secondary-link" onClick={onOpenHistory}>
          View History
        </button>
        <button className="android-secondary-link" onClick={onOpenDashboard}>
          Dashboard
        </button>

        <details className="hrv-details android-hrv-details">
          <summary className="hrv-summary">HRV Analysis (optional)</summary>
          <HRVAnalysis
            isConnected={connection.isConnected}
            testState={session.hrvTestState}
            results={session.hrvResults}
            onStartTest={session.startHRVTest}
            onStopTest={session.stopHRVTest}
          />
        </details>
      </main>
    </div>
  );
}

export default AndroidHome;
