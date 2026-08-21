import React, { useState } from 'react';

function ConnectionButton({ isConnected, isConnecting, deviceName, batteryLevel, deviceInfo, sensorLocation, onConnect, onDisconnect, connectDisabled }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasExtendedInfo = deviceInfo && (
    deviceInfo.manufacturer ||
    deviceInfo.model ||
    deviceInfo.serial ||
    deviceInfo.hardwareRevision ||
    deviceInfo.firmwareRevision ||
    deviceInfo.softwareRevision ||
    sensorLocation
  );

  return (
    <>
      {!isConnected ? (
        <button
          className="btn-primary"
          onClick={onConnect}
          disabled={isConnecting || connectDisabled}
          style={{ width: '100%' }}
        >
          {isConnecting ? 'Connecting...' : 'Connect to HR Monitor'}
        </button>
      ) : (
        <div className="connection-status">
          <div className="connection-header">
            <div className="device-info">
              <span className="status-indicator connected"></span>
              <span className="device-name">{deviceName}</span>
              {hasExtendedInfo && (
                <button
                  className="device-info-toggle-inline"
                  onClick={() => setIsExpanded(!isExpanded)}
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? 'Hide device details' : 'Show device details'}
                >
                  {isExpanded ? '▼' : '▶'}
                </button>
              )}
              {batteryLevel !== null && (
                <span className="battery-level">
                  <span className="battery-icon">🔋</span>
                  {batteryLevel}%
                </span>
              )}
            </div>
            <button className="btn-danger" onClick={onDisconnect}>
              Disconnect
            </button>
          </div>

          {hasExtendedInfo && isExpanded && (
            <div className="device-info-extended">
              {sensorLocation && (
                <div className="device-info-row">
                  <span className="device-info-row-label">Sensor Location:</span>
                  <span className="device-info-row-value">{sensorLocation}</span>
                </div>
              )}
              {deviceInfo?.manufacturer && (
                <div className="device-info-row">
                  <span className="device-info-row-label">Manufacturer:</span>
                  <span className="device-info-row-value">{deviceInfo.manufacturer}</span>
                </div>
              )}
              {deviceInfo?.model && (
                <div className="device-info-row">
                  <span className="device-info-row-label">Model:</span>
                  <span className="device-info-row-value">{deviceInfo.model}</span>
                </div>
              )}
              {deviceInfo?.serial && (
                <div className="device-info-row">
                  <span className="device-info-row-label">Serial Number:</span>
                  <span className="device-info-row-value">{deviceInfo.serial}</span>
                </div>
              )}
              {deviceInfo?.firmwareRevision && (
                <div className="device-info-row">
                  <span className="device-info-row-label">Firmware:</span>
                  <span className="device-info-row-value">{deviceInfo.firmwareRevision}</span>
                </div>
              )}
              {deviceInfo?.hardwareRevision && (
                <div className="device-info-row">
                  <span className="device-info-row-label">Hardware:</span>
                  <span className="device-info-row-value">{deviceInfo.hardwareRevision}</span>
                </div>
              )}
              {deviceInfo?.softwareRevision && (
                <div className="device-info-row">
                  <span className="device-info-row-label">Software:</span>
                  <span className="device-info-row-value">{deviceInfo.softwareRevision}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default ConnectionButton;
