import React, { useState } from 'react';

function toDatetimeLocalValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Lets the user trim a completed session's effective end time earlier (to
 * cut an accidentally over-recorded tail) or move it back toward the
 * recorded stop (to undo a previous trim) - never earlier than the session
 * start, never later than when it was actually recorded to have stopped.
 */
function EditEndTimeDialog({ session, onCancel, onSave }) {
  const [value, setValue] = useState(
    toDatetimeLocalValue(session.effectiveEndedAt || session.endedAt)
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const chosen = new Date(value);
    const start = new Date(session.startedAt);
    const recordedStop = new Date(session.endedAt);

    if (Number.isNaN(chosen.getTime())) {
      setError('Enter a valid date and time');
      return;
    }
    if (chosen < start) {
      setError('End time cannot be earlier than the session start');
      return;
    }
    if (chosen > recordedStop) {
      setError('End time cannot be later than the recorded stop');
      return;
    }

    setSaving(true);
    try {
      await onSave(chosen.toISOString());
    } catch (err) {
      setError('Failed to save: ' + err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="modal-title">Edit session end</h2>

        <div className="edit-end-row">
          <span className="edit-end-label">Start</span>
          <span className="edit-end-value">{formatTime(session.startedAt)}</span>
        </div>
        <div className="edit-end-row">
          <span className="edit-end-label">Recorded stop</span>
          <span className="edit-end-value">{formatTime(session.endedAt)}</span>
        </div>

        <label className="edit-end-field-label" htmlFor="effective-end-input">
          End session at
        </label>
        <input
          id="effective-end-input"
          type="datetime-local"
          step="1"
          value={value}
          min={toDatetimeLocalValue(session.startedAt)}
          max={toDatetimeLocalValue(session.endedAt)}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          className="edit-end-input"
        />

        {error && <p className="edit-end-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditEndTimeDialog;
