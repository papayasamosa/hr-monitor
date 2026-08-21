import React from 'react';

/**
 * HRVAnalysis Component
 *
 * Displays HRV (Heart Rate Variability) analysis interface
 * Three states: Idle (ready to start), Testing (in progress), Results (complete)
 *
 * @param {boolean} isConnected - Whether a device is connected
 * @param {Object} testState - Current test state
 * @param {boolean} testState.isRunning - Whether test is in progress
 * @param {number} testState.duration - Total test duration in ms
 * @param {number} testState.elapsed - Elapsed time in ms
 * @param {number} testState.rrCount - Number of RR intervals collected
 * @param {Object} results - Test results (null if no results)
 * @param {number} results.rmssd - RMSSD value in ms
 * @param {number} results.sdnn - SDNN value in ms
 * @param {number} results.rrCount - Number of RR intervals used
 * @param {string} results.warning - Warning message if RR intervals are suspicious
 * @param {string} results.error - Error message if test failed
 * @param {Function} onStartTest - Callback to start HRV test
 * @param {Function} onStopTest - Callback to stop HRV test
 */
function HRVAnalysis({
  isConnected,
  testState,
  results,
  onStartTest,
  onStopTest
}) {
  // Don't show if not connected
  if (!isConnected) return null;

  /**
   * Format milliseconds to MM:SS display
   */
  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="hrv-section">
      {/* Idle State - Ready to start test */}
      {!testState.isRunning && !results && (
        <div className="hrv-idle">
          <p className="hrv-description">
            Measure heart rate variability over 2 minutes for RMSSD and SDNN metrics.
          </p>
          <button onClick={onStartTest} className="btn-primary hrv-start-btn">
            Start HRV Test (2 min)
          </button>
          <p className="hrv-note">
            Requires RR interval data from your heart rate monitor
          </p>
        </div>
      )}

      {/* Testing State - Collection in progress */}
      {testState.isRunning && (
        <div className="hrv-testing">
          <p className="hrv-status">Collecting RR intervals...</p>

          <div className="hrv-progress-container">
            <div className="hrv-progress-bar">
              <div
                className="hrv-progress-fill"
                style={{ width: `${(testState.elapsed / testState.duration) * 100}%` }}
              />
            </div>
            <p className="hrv-countdown">
              {formatTime(testState.duration - testState.elapsed)}
            </p>
          </div>

          <div className="hrv-rr-count">
            <span className="hrv-label">RR intervals:</span>
            <span className="hrv-value">{testState.rrCount}</span>
          </div>

          <button onClick={onStopTest} className="btn-secondary hrv-stop-btn">
            Stop Test
          </button>
        </div>
      )}

      {/* Results State - Test completed */}
      {results && (
        <div className="hrv-results">
          <h3>Test Results</h3>

          {/* Error message */}
          {results.error && (
            <div className="hrv-error">
              ❌ {results.error}
            </div>
          )}

          {/* Warning message for suspicious RR intervals */}
          {results.warning && !results.error && (
            <div className="hrv-warning">
              {results.warning}
            </div>
          )}

          {/* HRV Metrics */}
          {!results.error && (
            <div className="hrv-metrics-grid">
              <div className="hrv-metric">
                <span className="hrv-metric-label">RMSSD</span>
                <span className="hrv-metric-value">
                  {results.rmssd.toFixed(1)} <span className="hrv-unit">ms</span>
                </span>
                <span className="hrv-metric-description">Short-term variability</span>
              </div>

              <div className="hrv-metric">
                <span className="hrv-metric-label">SDNN</span>
                <span className="hrv-metric-value">
                  {results.sdnn.toFixed(1)} <span className="hrv-unit">ms</span>
                </span>
                <span className="hrv-metric-description">Overall variability</span>
              </div>

              <div className="hrv-metric">
                <span className="hrv-metric-label">RR Intervals</span>
                <span className="hrv-metric-value">
                  {results.rrCount}
                </span>
                <span className="hrv-metric-description">Data points analyzed</span>
              </div>
            </div>
          )}

          <button onClick={onStartTest} className="btn-primary hrv-new-test-btn">
            New Test
          </button>
        </div>
      )}
    </div>
  );
}

export default HRVAnalysis;
