import { isNativePlatform } from '../platform';
import * as webSessionRecorder from './webSessionRecorder';
import * as androidSessionRecorder from './androidSessionRecorder';

/**
 * Session recording orchestration: web drives IndexedDB writes directly from
 * React; Android delegates the whole recording lifecycle to the native
 * foreground service. Both expose: startRecording, recordReading,
 * stopRecording, recoverInterruptedSessions.
 */
const sessionRecorder = isNativePlatform() ? androidSessionRecorder : webSessionRecorder;

export default sessionRecorder;
