import React, { useState } from 'react';
import { parseHeartRateCsv, validateImportedSession, importSession } from '../services/session/csvImport';

function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

/**
 * File picker -> preview -> confirm import, all state kept local to this
 * dialog. The actual parsing/validation/writing logic lives entirely in
 * services/session/csvImport.js - this component only calls into it and
 * renders the result, it never touches storage directly.
 */
function CsvImportDialog({ onCancel, onImported }) {
  const [parsed, setParsed] = useState(null);
  const [preview, setPreview] = useState(null);
  const [sessionTypeChoice, setSessionTypeChoice] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setResult(null);
    setSessionTypeChoice('');
    try {
      const p = await parseHeartRateCsv(file, file.name);
      setParsed(p);
      setPreview(validateImportedSession(p));
    } catch (err) {
      setParsed(null);
      setPreview(null);
      setError('Failed to read file: ' + err.message);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setError('');
    try {
      const sessionType = preview.sessionType || sessionTypeChoice;
      const res = await importSession(parsed, { sessionType });
      setResult(res);
      if (!res.duplicate) onImported?.(res.sessionId);
    } catch (err) {
      setError('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  const canImport = preview && preview.validReadingCount > 0 && (preview.sessionType || sessionTypeChoice) && !result;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="modal-title">Import CSV</h2>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="csv-import-file-input"
          aria-label="Choose CSV file"
        />

        {error && <div className="error-message">{error}</div>}

        {preview && (
          <div className="csv-import-preview">
            <p className="csv-import-filename">{preview.filename}</p>
            <p>
              {preview.validReadingCount} valid reading(s)
              {preview.invalidReadingCount > 0 ? `, ${preview.invalidReadingCount} skipped` : ''}
            </p>
            <p>{formatDateTime(preview.startAt)} &ndash; {formatDateTime(preview.endAt)}</p>
            {preview.containsSpeedData && <p>Includes treadmill speed data</p>}
            {preview.warnings.map((w, i) => (
              <p key={i} className="csv-import-warning">{w}</p>
            ))}

            {!preview.sessionType && preview.validReadingCount > 0 && (
              <div className="csv-import-session-type">
                <label htmlFor="csv-import-session-type-select">Session type</label>
                <select
                  id="csv-import-session-type-select"
                  value={sessionTypeChoice}
                  onChange={(e) => setSessionTypeChoice(e.target.value)}
                >
                  <option value="">Choose one&hellip;</option>
                  <option value="cardio">Cardio</option>
                  <option value="strength">Strength</option>
                </select>
              </div>
            )}
          </div>
        )}

        {result && (
          <p className="info-message">
            {result.duplicate
              ? 'This recording was already imported previously - no new session was created.'
              : `Imported ${result.readingCount} reading(s) as a new session.`}
          </p>
        )}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={importing}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button className="btn-primary" onClick={handleImport} disabled={!canImport || importing}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default CsvImportDialog;
