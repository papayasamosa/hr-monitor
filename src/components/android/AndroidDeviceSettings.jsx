import React from 'react';

const STATUS_LABEL = {
  connected: 'Connected',
  connecting: 'Connecting…',
  not_connected: 'Not connected',
  no_device: 'Not configured'
};

/**
 * Secondary screen for device management - kept off the main recording
 * screen so it doesn't dominate it. Handles both "nothing configured yet"
 * (first run) and "a device is known, but maybe not currently connected".
 */
function AndroidDeviceSettings({ connection, onBack }) {
  const { connectionState, deviceName, batteryLevel, error, reconnect, connectNewDevice, forgetDevice } = connection;

  const handleForget = async () => {
    if (!window.confirm(`Forget ${deviceName || 'this device'}? You'll need to connect again to record.`)) return;
    await forgetDevice();
  };

  return (
    <div className="android-home">
      <header className="android-header android-header-with-back">
        <button className="back-link" onClick={onBack}>&larr; Back</button>
        <h1>Heart Rate Monitor</h1>
      </header>

      <main className="android-main">
        {error && <div className="error-message">{error}</div>}

        {connectionState === 'no_device' ? (
          <>
            <p className="info-message">No heart rate monitor configured yet.</p>
            <button className="android-primary-btn" onClick={connectNewDevice}>
              Connect Monitor
            </button>
          </>
        ) : (
          <>
            <div className="device-info-extended">
              <div className="device-info-row">
                <span className="device-info-row-label">Current device</span>
                <span className="device-info-row-value">{deviceName || 'Unknown'}</span>
              </div>
              <div className="device-info-row">
                <span className="device-info-row-label">Status</span>
                <span className="device-info-row-value">{STATUS_LABEL[connectionState]}</span>
              </div>
              {connectionState === 'connected' && batteryLevel !== null && (
                <div className="device-info-row">
                  <span className="device-info-row-label">Battery</span>
                  <span className="device-info-row-value">{batteryLevel}%</span>
                </div>
              )}
            </div>

            <div className="android-device-actions">
              {connectionState !== 'connected' && (
                <button className="btn-primary" onClick={reconnect} disabled={connectionState === 'connecting'}>
                  {connectionState === 'connecting' ? 'Connecting…' : 'Reconnect'}
                </button>
              )}
              <button className="btn-secondary" onClick={connectNewDevice}>
                Change Device
              </button>
              <button className="btn-danger" onClick={handleForget}>
                Forget Device
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default AndroidDeviceSettings;
