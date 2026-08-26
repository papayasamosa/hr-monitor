import React, { useCallback, useEffect, useState } from 'react';
import storage from '../services/storage';
import { exportSessionCSV } from '../services/session/exportSession';
import CsvImportDialog from './CsvImportDialog';

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

function formatStartTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function HistoryView({ onBack, onOpenSession }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [showImport, setShowImport] = useState(false);

  const loadSessions = useCallback(async () => {
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
    loadSessions();
  }, [loadSessions]);

  const handleExport = async (sessionId, event) => {
    event.stopPropagation();
    setBusyId(sessionId);
    try {
      await exportSessionCSV(sessionId);
    } catch (err) {
      setError('Failed to export CSV: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (sessionId, event) => {
    event.stopPropagation();
    if (!window.confirm('Delete this recording? This cannot be undone.')) return;
    setBusyId(sessionId);
    try {
      await storage.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setError('Failed to delete session: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="hr-monitor">
      <header className="header header-with-back">
        <button className="back-link" onClick={onBack}>&larr; Back</button>
        <h1>Recent Recordings</h1>
      </header>

      <main className="main-content">
        <button className="btn-secondary history-import-btn" onClick={() => setShowImport(true)}>
          Import CSV
        </button>

        {error && <div className="error-message">{error}</div>}
        {loading && <p className="info-message">Loading history...</p>}
        {!loading && sessions.length === 0 && (
          <p className="info-message">No recordings yet. Start one from the Monitor screen.</p>
        )}

        <ul className="history-list">
          {sessions.map((session) => (
            <li key={session.id} className="history-item" onClick={() => onOpenSession(session.id)}>
              <div className="history-item-header">
                <span className="history-item-date">{formatDateHeading(session.startedAt)}</span>
                <span className="history-item-time">{formatStartTime(session.startedAt)}</span>
                {session.status !== 'completed' && (
                  <span className={`history-item-status status-${session.status}`}>{session.status}</span>
                )}
              </div>
              <div className="history-item-duration">{formatDuration(session.durationMs)}</div>
              <div className="history-item-stats">
                Avg {session.averageHeartRate} &middot; Min {session.minimumHeartRate} &middot; Max {session.maximumHeartRate}
              </div>
              <div className="history-item-meta">
                {session.readingCount} readings{session.sessionType ? ` · ${session.sessionType}` : ''}
              </div>
              <div className="history-item-actions">
                <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); onOpenSession(session.id); }}>
                  Open
                </button>
                <button className="btn-secondary" onClick={(e) => handleExport(session.id, e)} disabled={busyId === session.id}>
                  Export CSV
                </button>
                <button className="btn-danger" onClick={(e) => handleDelete(session.id, e)} disabled={busyId === session.id}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </main>

      {showImport && (
        <CsvImportDialog
          onCancel={() => setShowImport(false)}
          onImported={() => loadSessions()}
        />
      )}
    </div>
  );
}

export default HistoryView;
