import React, { useCallback, useEffect, useState } from 'react';
import storage from '../services/storage';
import { exportSessionCSV } from '../services/session/exportSession';
import { filterReadingsByEffectiveEnd } from '../services/session/sessionModel';
import { setEffectiveEndTime, restoreEffectiveEndTime } from '../services/session/trimSession';
import HeartRateChart from './HeartRateChart';
import EditEndTimeDialog from './EditEndTimeDialog';

function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function formatDuration(ms) {
  const totalSeconds = Math.floor((ms || 0) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function SessionDetailView({ sessionId, onBack }) {
  const [session, setSession] = useState(null);
  const [readings, setReadings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingEndTime, setEditingEndTime] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([storage.getSession(sessionId), storage.getReadings(sessionId)]);
      setSession(s);
      setReadings(r);
    } catch (err) {
      setError('Failed to load session: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportSessionCSV(sessionId);
    } catch (err) {
      setError('Failed to export CSV: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this recording? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await storage.deleteSession(sessionId);
      onBack();
    } catch (err) {
      setError('Failed to delete session: ' + err.message);
      setDeleting(false);
    }
  };

  const handleSaveEndTime = async (effectiveEndedAtIso) => {
    await setEffectiveEndTime(sessionId, effectiveEndedAtIso);
    setEditingEndTime(false);
    await load();
  };

  const handleRestoreEndTime = async () => {
    await restoreEffectiveEndTime(sessionId);
    await load();
  };

  const isTrimmed = session && session.effectiveEndedAt && session.effectiveEndedAt !== session.endedAt;
  const includedReadings = session ? filterReadingsByEffectiveEnd(readings, session) : readings;

  return (
    <div className="hr-monitor">
      <header className="header header-with-back">
        <button className="back-link" onClick={onBack}>&larr; Back</button>
        <h1>Session Detail</h1>
      </header>

      <main className="main-content">
        {error && <div className="error-message">{error}</div>}
        {loading && <p className="info-message">Loading session...</p>}
        {!loading && !session && !error && <p className="info-message">Session not found.</p>}

        {!loading && session && (
          <>
            <div className="device-info-extended session-detail-meta">
              <div className="device-info-row">
                <span className="device-info-row-label">Started</span>
                <span className="device-info-row-value">{formatDateTime(session.startedAt)}</span>
              </div>
              <div className="device-info-row">
                <span className="device-info-row-label">Ended</span>
                <span className="device-info-row-value">
                  {formatDateTime(session.effectiveEndedAt || session.endedAt)}
                </span>
              </div>
              <div className="device-info-row">
                <span className="device-info-row-label">Duration</span>
                <span className="device-info-row-value">{formatDuration(session.durationMs)}</span>
              </div>
              <div className="device-info-row">
                <span className="device-info-row-label">Device</span>
                <span className="device-info-row-value">{session.deviceName || 'Unknown'}</span>
              </div>
              {session.sessionType && (
                <div className="device-info-row">
                  <span className="device-info-row-label">Type</span>
                  <span className="device-info-row-value">{session.sessionType}</span>
                </div>
              )}
              <div className="device-info-row">
                <span className="device-info-row-label">Status</span>
                <span className="device-info-row-value">{session.status}</span>
              </div>
            </div>

            {isTrimmed && (
              <p className="trimmed-note">
                End time adjusted &middot; Originally recorded until {formatDateTime(session.endedAt)}
                {' '}
                <button className="link-btn" onClick={handleRestoreEndTime}>Restore</button>
              </p>
            )}

            <div className="stats-grid session-detail-stats">
              <div className="stat-card">
                <div className="stat-label">Average</div>
                <div className="stat-value">{session.averageHeartRate}</div>
                <div className="stat-unit">BPM</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Maximum</div>
                <div className="stat-value">{session.maximumHeartRate}</div>
                <div className="stat-unit">BPM</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Minimum</div>
                <div className="stat-value">{session.minimumHeartRate}</div>
                <div className="stat-unit">BPM</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Readings</div>
                <div className="stat-value">{session.readingCount}</div>
                <div className="stat-unit">samples</div>
              </div>
            </div>

            <HeartRateChart readings={includedReadings} />

            <div className="session-detail-actions">
              <button className="btn-secondary" onClick={() => setEditingEndTime(true)}>
                Edit End Time
              </button>
              <button className="btn-primary" onClick={handleExport} disabled={exporting}>
                Export CSV
              </button>
              <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
                Delete
              </button>
            </div>
          </>
        )}
      </main>

      {editingEndTime && session && (
        <EditEndTimeDialog
          session={session}
          onCancel={() => setEditingEndTime(false)}
          onSave={handleSaveEndTime}
        />
      )}
    </div>
  );
}

export default SessionDetailView;
