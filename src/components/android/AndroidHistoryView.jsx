import React, { useCallback, useEffect, useState } from 'react';
import storage from '../../services/storage';

function formatDuration(ms) {
  if (!ms) return '0 min';
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return '<1 min';
  return `${totalMinutes} min`;
}

function formatDateHeading(iso) {
  const d = new Date(iso);
  const isToday = d.toDateString() === new Date().toDateString();
  return isToday ? 'Today' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function formatTimeRange(startedAt, endedAt) {
  const opts = { hour: '2-digit', minute: '2-digit' };
  const start = new Date(startedAt).toLocaleTimeString(undefined, opts);
  const end = endedAt ? new Date(endedAt).toLocaleTimeString(undefined, opts) : '—';
  return `${start} – ${end}`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function AndroidHistoryView({ onBack, onOpenSession }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await storage.listSessions());
    } catch (err) {
      setError('Failed to load history: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="android-home">
      <header className="android-header android-header-with-back">
        <button className="back-link" onClick={onBack}>&larr; Back</button>
        <h1>History</h1>
      </header>

      <main className="android-main">
        {error && <div className="error-message">{error}</div>}
        {loading && <p className="info-message">Loading history...</p>}
        {!loading && sessions.length === 0 && (
          <p className="info-message">No recordings yet.</p>
        )}

        <ul className="android-history-list">
          {sessions.map((session) => (
            <li key={session.id} className="android-history-card" onClick={() => onOpenSession(session.id)}>
              <div className="android-history-card-heading">
                <span>{formatDateHeading(session.startedAt)}</span>
                {session.sessionType && <span>&middot; {capitalize(session.sessionType)}</span>}
                {session.status !== 'completed' && (
                  <span className={`history-item-status status-${session.status}`}>{session.status}</span>
                )}
              </div>
              <div className="android-history-card-time">
                {formatTimeRange(session.startedAt, session.effectiveEndedAt || session.endedAt)}
              </div>
              <div className="android-history-card-duration">{formatDuration(session.durationMs)}</div>
              <div className="android-history-card-stats">
                Avg {session.averageHeartRate} &middot; Min {session.minimumHeartRate} &middot; Max {session.maximumHeartRate}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

export default AndroidHistoryView;
