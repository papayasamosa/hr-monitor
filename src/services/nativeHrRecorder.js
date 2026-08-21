import { registerPlugin } from '@capacitor/core';

/**
 * Single shared handle to the native HrRecorder Capacitor plugin.
 * Capacitor's registerPlugin() is meant to be called once per plugin name -
 * calling it again elsewhere logs "already registered" and is a no-op, so
 * androidBluetooth.js, androidStorage.js, and androidSessionRecorder.js all
 * import this instead of registering their own copies.
 */
const HrRecorder = registerPlugin('HrRecorder');

export default HrRecorder;
