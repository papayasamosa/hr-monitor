/**
 * CSV import as an isolated pipeline, kept deliberately separate from any UI
 * component: parseHeartRateCsv (pure parsing) -> validateImportedSession
 * (pure summarization, produces a CsvImportPreview) -> importSession (the
 * only function that touches storage, and does so exclusively through the
 * shared storage repository - see services/storage - never a raw DB call).
 *
 * CsvImportPreview shape:
 *   { filename, startAt, endAt, effectiveEndedAt, sessionType, validReadingCount,
 *     invalidReadingCount, containsSpeedData, warnings: string[] }
 */
import storage from '../storage';
import { generateId } from './sessionModel';
import { createSpeedEventRecord } from './speedEventModel';
import { toCanonicalKmh } from './speedUnits';

// Exact column names our own exporter writes, checked first; fallback names
// are only consulted if none of the exact names are present, so a genuine
// heart-rate CSV is always read correctly even if a looser third-party file
// happens to use a similar-but-different header.
const COLUMN_CANDIDATES = {
  timestamp: ['timestamp'],
  heartRate: ['heart_rate_bpm', 'heart_rate', 'bpm', 'hr'],
  sessionType: ['session_type', 'type'],
  treadmillSpeed: ['treadmill_speed', 'speed'],
  treadmillSpeedUnit: ['treadmill_speed_unit', 'speed_unit']
};

async function readFileText(file) {
  if (typeof file === 'string') return file;
  if (file && typeof file.text === 'function') return file.text();
  throw new Error('Unsupported file input - expected a string or a File/Blob with a .text() method');
}

function resolveColumnIndex(headerCells, candidates) {
  const normalized = headerCells.map((h) => h.trim().toLowerCase());
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse raw CSV text/File into row objects. Never touches storage. Rows
 * that fail basic validity (unparseable timestamp, missing/non-positive
 * heart rate) are kept with `valid: false` rather than dropped outright, so
 * validateImportedSession can report exactly how many were skipped.
 */
export async function parseHeartRateCsv(file, filename) {
  const text = await readFileText(file);
  const resolvedFilename = filename || (file && file.name) || 'import.csv';
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const warnings = [];

  if (lines.length === 0) {
    return { filename: resolvedFilename, rows: [], warnings: ['File is empty'] };
  }

  const headerCells = lines[0].split(',');
  const columnIndex = {
    timestamp: resolveColumnIndex(headerCells, COLUMN_CANDIDATES.timestamp),
    heartRate: resolveColumnIndex(headerCells, COLUMN_CANDIDATES.heartRate),
    sessionType: resolveColumnIndex(headerCells, COLUMN_CANDIDATES.sessionType),
    treadmillSpeed: resolveColumnIndex(headerCells, COLUMN_CANDIDATES.treadmillSpeed),
    treadmillSpeedUnit: resolveColumnIndex(headerCells, COLUMN_CANDIDATES.treadmillSpeedUnit)
  };

  if (columnIndex.timestamp === -1 || columnIndex.heartRate === -1) {
    return {
      filename: resolvedFilename,
      rows: [],
      warnings: ['Missing required timestamp/heart rate columns - this does not look like a heart rate CSV']
    };
  }
  if (columnIndex.treadmillSpeed === -1) {
    warnings.push('No treadmill speed column found (an older export format) - importing without speed data');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const timestamp = cells[columnIndex.timestamp]?.trim() || '';
    const heartRateRaw = cells[columnIndex.heartRate]?.trim() ?? '';
    const heartRate = Number(heartRateRaw);
    const timestampMs = timestamp ? new Date(timestamp).getTime() : NaN;
    const valid = Boolean(timestamp) && !Number.isNaN(timestampMs) && heartRateRaw !== '' && !Number.isNaN(heartRate) && heartRate > 0;

    const sessionType = columnIndex.sessionType !== -1 ? cells[columnIndex.sessionType]?.trim() || null : null;
    const speedRaw = columnIndex.treadmillSpeed !== -1 ? cells[columnIndex.treadmillSpeed]?.trim() : '';
    const speedUnitRaw = columnIndex.treadmillSpeedUnit !== -1 ? cells[columnIndex.treadmillSpeedUnit]?.trim() : '';
    const speedValueNumber = speedRaw ? Number(speedRaw) : NaN;

    rows.push({
      lineNumber: i + 1,
      timestamp,
      heartRate,
      sessionType: sessionType || null,
      speedValue: speedRaw && !Number.isNaN(speedValueNumber) ? speedValueNumber : null,
      speedUnit: speedUnitRaw || null,
      valid
    });
  }

  return { filename: resolvedFilename, rows, warnings };
}

/** Summarize a parsed file into a CsvImportPreview without writing anything. */
export function validateImportedSession(parsed) {
  const validRows = parsed.rows.filter((r) => r.valid);
  const invalidReadingCount = parsed.rows.length - validRows.length;
  const warnings = [...parsed.warnings];

  if (validRows.length === 0) {
    warnings.push('No valid heart rate readings found in this file');
    return {
      filename: parsed.filename,
      startAt: null,
      endAt: null,
      effectiveEndedAt: null,
      sessionType: null,
      validReadingCount: 0,
      invalidReadingCount,
      containsSpeedData: false,
      warnings
    };
  }

  const sorted = [...validRows].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const startAt = sorted[0].timestamp;
  const endAt = sorted[sorted.length - 1].timestamp;

  const sessionTypes = new Set(validRows.map((r) => r.sessionType).filter(Boolean));
  const sessionType = sessionTypes.size === 1 ? [...sessionTypes][0] : null;
  if (sessionTypes.size > 1) warnings.push('Multiple session types found in the file - please choose one to import as');
  if (sessionTypes.size === 0) warnings.push('No session type found in the file - please choose one to import as');
  if (invalidReadingCount > 0) warnings.push(`${invalidReadingCount} row(s) skipped due to invalid or missing data`);

  const containsSpeedData = validRows.some((r) => r.speedValue !== null && r.speedUnit);

  return {
    filename: parsed.filename,
    startAt,
    endAt,
    effectiveEndedAt: endAt,
    sessionType,
    validReadingCount: validRows.length,
    invalidReadingCount,
    containsSpeedData,
    warnings
  };
}

/**
 * Reduce the per-reading forward-filled speed column down to its change
 * points (canonical km/h), in chronological order. Shared by the fingerprint
 * (so two files that differ only in treadmill speed never collide) and the
 * actual speed-event reconstruction during import, so the two can never
 * silently drift apart into different definitions of "a speed change".
 */
function computeSpeedChangePoints(sortedValidRows) {
  const points = [];
  let lastCanonical = null;
  for (const row of sortedValidRows) {
    if (row.speedValue === null || !row.speedUnit) continue;
    const canonical = toCanonicalKmh(row.speedValue, row.speedUnit);
    if (lastCanonical === null || canonical !== lastCanonical) {
      points.push({ timestamp: row.timestamp, canonical, enteredValue: row.speedValue, enteredUnit: row.speedUnit });
      lastCanonical = canonical;
    }
  }
  return points;
}

/**
 * Deterministic fingerprint of the semantically imported session - not just
 * its filename, and not just its raw HR readings. Two files must fingerprint
 * identically only when they'd produce the same session in every way that
 * matters: same readings, same resolved session type, and the same
 * treadmill-speed history (in canonical units, so 5 km/h and ~3.1 mph of the
 * same physical speed still match). Session type and speed are included
 * specifically so a file re-imported under a different session type, or an
 * otherwise-identical file with different treadmill speeds, are never
 * incorrectly collapsed into "the same recording".
 */
async function computeFingerprint(sortedValidRows, sessionType) {
  const speedChangePoints = computeSpeedChangePoints(sortedValidRows);
  const parts = [
    `type:${sessionType || ''}`,
    `speed:${speedChangePoints.map((p) => `${new Date(p.timestamp).toISOString()}@${p.canonical}`).join(',')}`,
    ...sortedValidRows.map((r) => `${new Date(r.timestamp).toISOString()}|${Math.round(r.heartRate)}`)
  ];
  const data = new TextEncoder().encode(parts.join('\n'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Write a parsed, validated file to storage as a new session. Transactional
 * at the application level: if any step after session creation fails, the
 * partially-written session (and anything already inserted under it) is
 * deleted so no half-imported session is left behind.
 *
 * @param {object} parsed - result of parseHeartRateCsv
 * @param {object} [overrides]
 * @param {string} [overrides.sessionType] - required if the file's rows
 *   don't unambiguously agree on one (see CsvImportPreview.sessionType)
 * @param {string} [overrides.deviceName]
 * @returns {Promise<{duplicate: boolean, sessionId: string, readingCount?: number}>}
 */
export async function importSession(parsed, overrides = {}) {
  const validRows = parsed.rows
    .filter((r) => r.valid)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (validRows.length === 0) throw new Error('No valid readings to import');

  const fileSessionTypes = new Set(validRows.map((r) => r.sessionType).filter(Boolean));
  const sessionType = overrides.sessionType || (fileSessionTypes.size === 1 ? [...fileSessionTypes][0] : null);
  if (!sessionType) throw new Error('sessionType is required to import this file (could not be recovered from it)');

  const fingerprint = await computeFingerprint(validRows, sessionType);
  const existing = await storage.findSessionByImportFingerprint(fingerprint);
  if (existing) {
    return { duplicate: true, sessionId: existing.id };
  }

  const startAt = validRows[0].timestamp;
  const endAt = validRows[validRows.length - 1].timestamp;
  const startMs = new Date(startAt).getTime();
  const sessionId = generateId();

  const session = {
    id: sessionId,
    startedAt: startAt,
    endedAt: null,
    effectiveEndedAt: null,
    durationMs: null,
    deviceName: overrides.deviceName || 'Imported',
    sessionType,
    averageHeartRate: 0,
    minimumHeartRate: 0,
    maximumHeartRate: 0,
    readingCount: 0,
    status: 'recording',
    importFingerprint: fingerprint
  };

  try {
    await storage.createSession(session);

    let sum = 0;
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const row of validRows) {
      await storage.appendReading(sessionId, {
        timestamp: row.timestamp,
        elapsedMs: new Date(row.timestamp).getTime() - startMs,
        heartRate: row.heartRate
      });
      sum += row.heartRate;
      count += 1;
      min = Math.min(min, row.heartRate);
      max = Math.max(max, row.heartRate);
    }

    // Reconstruct speed EVENTS from the same change points used to build
    // the fingerprint above - one new event only where the canonical speed
    // actually changes, never one per reading.
    for (const point of computeSpeedChangePoints(validRows)) {
      await storage.addSpeedEvent(
        createSpeedEventRecord({
          sessionId,
          recordedAt: point.timestamp,
          enteredValue: point.enteredValue,
          enteredUnit: point.enteredUnit
        })
      );
    }

    const effectiveEndedAt = overrides.effectiveEndedAt || endAt;
    await storage.finalizeSession(sessionId, {
      endedAt: endAt,
      effectiveEndedAt,
      durationMs: new Date(effectiveEndedAt).getTime() - startMs,
      status: 'completed',
      averageHeartRate: count > 0 ? Math.round(sum / count) : 0,
      minimumHeartRate: count > 0 ? min : 0,
      maximumHeartRate: count > 0 ? max : 0,
      readingCount: count
    });

    return { duplicate: false, sessionId, readingCount: count };
  } catch (err) {
    await storage.deleteSession(sessionId).catch(() => {});

    // The storage layer enforces importFingerprint uniqueness itself (see
    // the additive migration), as a backstop against the check-then-insert
    // race above (two concurrent imports of the same file both passing the
    // findSessionByImportFingerprint check before either has inserted). If
    // that's what actually happened, surface it as the duplicate it is
    // rather than a raw constraint-violation error.
    const wonByConcurrentImport = await storage.findSessionByImportFingerprint(fingerprint).catch(() => null);
    if (wonByConcurrentImport) {
      return { duplicate: true, sessionId: wonByConcurrentImport.id };
    }
    throw err;
  }
}
