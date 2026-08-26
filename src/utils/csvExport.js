/**
 * CSV export utilities for heart-rate recordings. Operates on the shared
 * session/reading shapes (see services/session/sessionModel.js) so the same
 * code exports a session that just finished or one reloaded from History.
 */
import { createSpeedResolver } from '../services/session/speedEventModel';
import { fromCanonicalKmh } from '../services/session/speedUnits';

const pad = (n) => String(n).padStart(2, '0');

/**
 * Build CSV content from a session's readings. Backwards compatible: the
 * original four columns keep their exact names/order, and
 * treadmill_speed/treadmill_speed_unit are appended at the end so older
 * exports (and anything that already parses the first four columns by
 * position) are unaffected.
 *
 * @param {Array<{timestamp: string, elapsedMs: number, heartRate: number}>} readings
 * @param {string|null} sessionType - 'strength', 'cardio', or null
 * @param {object} [options]
 * @param {Array<{recordedAt: string, speedCanonical: number}>} [options.speedEvents]
 * @param {'kmh'|'mph'} [options.speedUnit] - unit to render treadmill_speed in (defaults to 'kmh')
 * @returns {string} CSV content with header row
 */
export function buildCSV(readings, sessionType, { speedEvents, speedUnit = 'kmh' } = {}) {
  const header = 'timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit';
  const resolveSpeed = createSpeedResolver(speedEvents || []);

  const rows = readings.map((reading) => {
    const elapsedSeconds = (reading.elapsedMs / 1000).toFixed(3);
    const bpm = Math.round(reading.heartRate);
    const canonicalSpeed = resolveSpeed(reading.timestamp);
    // No speed event has fired yet for this reading - leave both fields
    // blank rather than inventing a value.
    const speed = canonicalSpeed === null ? '' : fromCanonicalKmh(canonicalSpeed, speedUnit);
    const unit = canonicalSpeed === null ? '' : speedUnit;
    return `${reading.timestamp},${elapsedSeconds},${bpm},${sessionType || ''},${speed},${unit}`;
  });

  return [header, ...rows].join('\n');
}

/**
 * Build a timestamped filename for a session, using local time per the
 * session's start time (the CSV's own timestamp column stays ISO 8601 UTC).
 * @param {string} startedAt - ISO 8601 session start timestamp
 * @returns {string} Filename like heart-rate-2026-08-21_17-02-14.csv
 */
export function buildRecordingFilename(startedAt) {
  const d = new Date(startedAt);
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `heart-rate-${y}-${mo}-${day}_${h}-${mi}-${s}.csv`;
}

/**
 * Trigger a browser download of CSV content
 * @param {string} csvContent
 * @param {string} filename
 */
export function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
