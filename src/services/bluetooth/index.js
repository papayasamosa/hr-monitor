import { isNativePlatform } from '../platform';
import * as webBluetooth from './webBluetooth';
import * as androidBluetooth from './androidBluetooth';

/**
 * Bluetooth: Web Bluetooth on web, native BLE (via the HrRecorder plugin) on
 * Android. Both adapters expose: isSupported, connect, startNotifications,
 * stopNotifications, disconnect, readBatteryLevel, readDeviceInformation,
 * readBodySensorLocation, onUnexpectedDisconnect.
 */
const bluetooth = isNativePlatform() ? androidBluetooth : webBluetooth;

export default bluetooth;
