/**
 * Web Bluetooth adapter - thin wrapper around the existing, working
 * src/utils/bluetooth.js implementation, reshaped to the normalized
 * connection interface shared with androidBluetooth.js.
 */
import * as webBle from '../../utils/bluetooth';

export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export async function connect() {
  const server = await webBle.connectToHeartRateMonitor();
  return { server, deviceName: server.device.name || 'Unknown Device' };
}

export async function startNotifications(connection, onReading) {
  const characteristic = await webBle.startHeartRateNotifications(connection.server, onReading);
  return { ...connection, characteristic };
}

export async function stopNotifications(connection) {
  if (connection?.characteristic) {
    await webBle.stopHeartRateNotifications(connection.characteristic);
  }
}

export async function disconnect(connection) {
  if (connection?.server) {
    webBle.disconnectDevice(connection.server);
  }
}

export async function readBatteryLevel(connection) {
  return webBle.readBatteryLevel(connection.server);
}

export async function readDeviceInformation(connection) {
  return webBle.readDeviceInformation(connection.server);
}

export async function readBodySensorLocation(connection) {
  return webBle.readBodySensorLocation(connection.server);
}

// Web Bluetooth's requestDevice() can only ever be called from a user gesture
// (a real click), so there's no way to reconnect silently on page load - the
// Connect button stays the explicit entry point on web. These exist purely so
// components can call the shared bluetooth interface without branching.
export async function autoReconnect() {
  return { connected: false };
}

export async function getRememberedDevice() {
  return null;
}

export async function forgetDevice() {}

/** Fires when the OS/browser drops the connection outside of an explicit disconnect() call */
export function onUnexpectedDisconnect(connection, callback) {
  if (!connection?.server) return () => {};
  connection.server.device.addEventListener('gattserverdisconnected', callback);
  return () => connection.server.device.removeEventListener('gattserverdisconnected', callback);
}
