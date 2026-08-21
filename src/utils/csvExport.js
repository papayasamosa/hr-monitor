/**
 * CSV export utilities for heart-rate recordings
 */

const pad = (n) => String(n).padStart(2, '0');

/**
 * Build CSV content from recorded readings
 * @param {Array<{timestamp: number, heartRate: number}>} readings - Readings with timestamp (ms elapsed since recording start)
 * @param {Date} startTime - Absolute start time of the recording
 * @param {string} sessionType - 'strength' or 'cardio'
 * @returns {string} CSV content with header row
 */
export function buildCSV(readings, startTime, sessionType) {
  const header = 'timestamp,elapsed_seconds,heart_rate_bpm,session_type';

  const rows = readings.map((reading) => {
    const absoluteTimestamp = new Date(startTime.getTime() + reading.timestamp).toISOString();
    const elapsedSeconds = (reading.timestamp / 1000).toFixed(3);
    const bpm = Math.round(reading.heartRate);
    return `${absoluteTimestamp},${elapsedSeconds},${bpm},${sessionType}`;
  });

  return [header, ...rows].join('\n');
}

/**
 * Build a timestamped filename for a recording, using UTC to match the CSV's ISO timestamps
 * @param {Date} startTime - Absolute start time of the recording
 * @param {string} sessionType - 'strength' or 'cardio'
 * @returns {string} Filename like heart-rate_strength_20260821_113010.csv
 */
export function buildRecordingFilename(startTime, sessionType) {
  const y = startTime.getUTCFullYear();
  const mo = pad(startTime.getUTCMonth() + 1);
  const d = pad(startTime.getUTCDate());
  const h = pad(startTime.getUTCHours());
  const mi = pad(startTime.getUTCMinutes());
  const s = pad(startTime.getUTCSeconds());
  return `heart-rate_${sessionType}_${y}${mo}${d}_${h}${mi}${s}.csv`;
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
