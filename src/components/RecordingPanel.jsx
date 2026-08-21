import React from 'react';

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function RecordingPanel({ isRecording, elapsedMs, startDisabled, onStart, onStop }) {
  return (
    <div className="recording-panel">
      <div className="recording-status">
        <span className={`recording-indicator ${isRecording ? 'active' : ''}`} />
        <span className="recording-label">{isRecording ? 'Recording' : 'Not recording'}</span>
        {isRecording && <span className="recording-timer">{formatElapsed(elapsedMs)}</span>}
      </div>

      {isRecording ? (
        <button className="btn-danger recording-stop-btn" onClick={onStop}>
          Stop Recording
        </button>
      ) : (
        <>
          <button
            className="btn-primary recording-start-btn"
            onClick={onStart}
            disabled={startDisabled}
          >
            Start Recording
          </button>
          {startDisabled && (
            <p className="recording-start-hint">Select a session type to begin</p>
          )}
        </>
      )}
    </div>
  );
}

export default RecordingPanel;
