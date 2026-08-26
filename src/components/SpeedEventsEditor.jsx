import React, { useState } from 'react';
import { recordSpeedChange, updateSpeedEvent, deleteSpeedEvent } from '../services/session/speedEvents';

function toDatetimeLocalValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function isWithinSession(date, sessionStart, sessionEnd) {
  return !Number.isNaN(date.getTime()) && date >= sessionStart && date <= sessionEnd;
}

function EventRow({ event, sessionStart, sessionEnd, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(event.enteredValue);
  const [unit, setUnit] = useState(event.enteredUnit);
  const [time, setTime] = useState(toDatetimeLocalValue(event.recordedAt));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const t = new Date(time);
    if (!isWithinSession(t, sessionStart, sessionEnd)) {
      setError('Time must be within the recorded session');
      return;
    }
    const parsedValue = parseFloat(value);
    if (!(parsedValue > 0)) {
      setError('Enter a positive speed');
      return;
    }
    setSaving(true);
    try {
      await onSave(event.id, { enteredValue: parsedValue, enteredUnit: unit, recordedAt: t.toISOString() });
      setEditing(false);
    } catch (err) {
      setError('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <li className="speed-event-row">
        <span className="speed-event-time">{formatTime(event.recordedAt)}</span>
        <span className="speed-event-value">{event.enteredValue} {event.enteredUnit}</span>
        <button className="btn-secondary btn-small" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn-danger btn-small" onClick={() => onDelete(event.id)}>Delete</button>
      </li>
    );
  }

  return (
    <li className="speed-event-row speed-event-row-editing">
      <input
        type="datetime-local"
        step="1"
        value={time}
        min={toDatetimeLocalValue(sessionStart.toISOString())}
        max={toDatetimeLocalValue(sessionEnd.toISOString())}
        onChange={(e) => setTime(e.target.value)}
      />
      <input type="number" step="0.1" min="0" value={value} onChange={(e) => setValue(e.target.value)} />
      <select value={unit} onChange={(e) => setUnit(e.target.value)}>
        <option value="kmh">km/h</option>
        <option value="mph">mph</option>
      </select>
      {error && <p className="edit-end-error">{error}</p>}
      <button className="btn-primary btn-small" onClick={handleSave} disabled={saving}>Save</button>
      <button className="btn-secondary btn-small" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
    </li>
  );
}

/**
 * Cardio-only session-detail editor for treadmill speed events: edit a
 * value/unit/timestamp, delete an incorrect one, or add one that was never
 * recorded live. Every change goes through services/session/speedEvents.js
 * (the same repository path recording uses), and every timestamp is
 * validated to stay inside the session's recorded window.
 */
function SpeedEventsEditor({ sessionId, session, speedEvents, onChange }) {
  const [adding, setAdding] = useState(false);
  const [newTime, setNewTime] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newUnit, setNewUnit] = useState('kmh');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const sessionStart = new Date(session.startedAt);
  const sessionEnd = new Date(session.effectiveEndedAt || session.endedAt);

  const handleUpdate = async (eventId, updates) => {
    await updateSpeedEvent(sessionId, eventId, updates);
    onChange();
  };

  const handleDelete = async (eventId) => {
    if (!window.confirm('Delete this speed event?')) return;
    await deleteSpeedEvent(eventId);
    onChange();
  };

  const startAdding = () => {
    setAdding(true);
    setNewTime(toDatetimeLocalValue(session.startedAt));
    setNewValue('');
    setError('');
  };

  const handleAdd = async () => {
    const t = new Date(newTime);
    if (!isWithinSession(t, sessionStart, sessionEnd)) {
      setError('Time must be within the recorded session');
      return;
    }
    const parsedValue = parseFloat(newValue);
    if (!(parsedValue > 0)) {
      setError('Enter a positive speed');
      return;
    }
    setSaving(true);
    try {
      await recordSpeedChange(sessionId, { enteredValue: parsedValue, enteredUnit: newUnit, recordedAt: t.toISOString() });
      setAdding(false);
      onChange();
    } catch (err) {
      setError('Failed to add: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="speed-events-editor">
      <h3 className="speed-events-title">Treadmill speed</h3>

      {speedEvents.length === 0 && !adding && (
        <p className="info-message">No speed events recorded for this session.</p>
      )}

      {speedEvents.length > 0 && (
        <ul className="speed-events-list">
          {speedEvents.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              sessionStart={sessionStart}
              sessionEnd={sessionEnd}
              onSave={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      )}

      {!adding ? (
        <button className="btn-secondary btn-small" onClick={startAdding}>Add speed event</button>
      ) : (
        <div className="speed-event-add-form">
          <input
            type="datetime-local"
            step="1"
            value={newTime}
            min={toDatetimeLocalValue(session.startedAt)}
            max={toDatetimeLocalValue(session.effectiveEndedAt || session.endedAt)}
            onChange={(e) => setNewTime(e.target.value)}
          />
          <input
            type="number"
            step="0.1"
            min="0"
            placeholder="Speed"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <select value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
            <option value="kmh">km/h</option>
            <option value="mph">mph</option>
          </select>
          {error && <p className="edit-end-error">{error}</p>}
          <div className="speed-event-add-form-actions">
            <button className="btn-primary btn-small" onClick={handleAdd} disabled={saving}>Save</button>
            <button className="btn-secondary btn-small" onClick={() => setAdding(false)} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SpeedEventsEditor;
