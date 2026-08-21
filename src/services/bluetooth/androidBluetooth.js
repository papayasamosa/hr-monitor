/**
 * Android Bluetooth adapter - delegates to the native HrRecorder Capacitor
 * plugin (android/app/.../HrRecorderPlugin.kt), which uses Android's
 * BluetoothGatt APIs directly rather than Web Bluetooth inside the WebView.
 * Exposes the same interface as webBluetooth.js.
 */
import HrRecorder from '../nativeHrRecorder';

export function isSupported() {
  return true;
}

export async function connect() {
  const { deviceId, deviceName } = await HrRecorder.connect();
  return { deviceId, deviceName: deviceName || 'Unknown Device' };
}

export async function startNotifications(connection, onReading) {
  const listener = await HrRecorder.addListener('heartRateReading', (data) => {
    onReading({ heartRate: data.heartRate, rrIntervals: data.rrIntervals || [] });
  });
  await HrRecorder.startNotifications({ deviceId: connection.deviceId });
  return { ...connection, listener };
}

export async function stopNotifications(connection) {
  if (connection?.listener) connection.listener.remove();
  if (connection?.deviceId) await HrRecorder.stopNotifications({ deviceId: connection.deviceId });
}

export async function disconnect(connection) {
  if (connection?.deviceId) await HrRecorder.disconnect({ deviceId: connection.deviceId });
}

export async function readBatteryLevel(connection) {
  try {
    const { level } = await HrRecorder.readBattery({ deviceId: connection.deviceId });
    return level;
  } catch {
    return null;
  }
}

// Android device-information/body-sensor-location reads aren't wired up
// natively yet - the standard Heart Rate + Battery services are the priority.
export async function readDeviceInformation() {
  return {};
}

export async function readBodySensorLocation() {
  return null;
}

/**
 * Silently reconnect to the last device the user explicitly connected to, if
 * any and if currently reachable. Never prompts for permission and never
 * throws - resolves { connected: false } as a normal outcome when there's no
 * remembered device, permission hasn't been granted yet, or the device isn't
 * in range/powered on right now.
 */
export async function autoReconnect() {
  return HrRecorder.autoReconnect();
}

/** The last device the user connected to, even if not currently connected/in range. */
export async function getRememberedDevice() {
  const { deviceId, deviceName } = await HrRecorder.getRememberedDevice();
  return deviceId ? { deviceId, deviceName } : null;
}

/** Disconnect (if connected) and clear the remembered device, so nothing auto-reconnects next launch. */
export async function forgetDevice() {
  await HrRecorder.forgetDevice();
}

/** Fires when the native layer reports the GATT link dropped unexpectedly */
export function onUnexpectedDisconnect(connection, callback) {
  if (!connection?.deviceId) return () => {};
  let listenerHandle = null;
  HrRecorder.addListener('deviceDisconnected', (data) => {
    if (data.deviceId === connection.deviceId) callback();
  }).then((listener) => {
    listenerHandle = listener;
  });
  return () => listenerHandle?.remove();
}
