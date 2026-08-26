import React, { useCallback, useEffect, useMemo, useState } from 'react';
import storage from '../services/storage';
import { exportSessionCSV } from '../services/session/exportSession';
import { filterReadingsByEffectiveEnd } from '../services/session/sessionModel';
import { calculateHeartRateStats } from '../services/session/heartRateStats';
import { setEffectiveEndTime, restoreEffectiveEndTime } from '../services/session/trimSession';
import { fromCanonicalKmh } from '../services/session/speedUnits';
import { getPreferredSpeedUnit } from '../services/session/speedUnitPreference';
import HeartRateChart from './HeartRateChart';
import EditEndTimeDialog from './EditEndTimeDialog';
import SpeedEventsEditor from './SpeedEventsEditor';

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
  const [speedEvents, setSpeedEvents] = useState([]);
  const [showSpeed, setShowSpeed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingEndTime, setEditingEndTime] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, sp] = await Promise.all([
        storage.getSession(sessionId),
        storage.getReadings(sessionId),
        storage.getSpeedEventsForSession(sessionId)
      ]);
      setSession(s);
      setReadings(r);
      setSpeedEvents(sp);
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
  const stats = calculateHeartRateStats(includedReadings);
  const speedUnit = getPreferredSpeedUnit();

  const chartSpeedEvents = useMemo(() => {
    if (!session || speedEvents.length === 0) return [];
    const startMs = new Date(session.startedAt).getTime();
    return speedEvents.map((event) => ({
      elapsedMs: new Date(event.recordedAt).getTime() - startMs,
      speed: fromCanonicalKmh(event.speedCanonical, speedUnit)
    }));
  }, [session, speedEvents, speedUnit]);

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
                <div className="stat-label">Lowest</div>
                <div className="stat-value">{stats ? stats.min : '—'}</div>
                <div className="stat-unit">BPM</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Typical low</div>
                <div className="stat-value">{stats ? Math.round(stats.p025) : '—'}</div>
                <div className="stat-unit">BPM</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Average</div>
                <div className="stat-value">{stats ? Math.round(stats.average) : '—'}</div>
                <div className="stat-unit">BPM</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Typical high</div>
                <div className="stat-value">{stats ? Math.round(stats.p975) : '—'}</div>
                <div className="stat-unit">BPM</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Highest</div>
                <div className="stat-value">{stats ? stats.max : '—'}</div>
                <div className="stat-unit">BPM</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Readings</div>
                <div className="stat-value">{session.readingCount}</div>
                <div className="stat-unit">samples</div>
              </div>
            </div>

            {chartSpeedEvents.length > 0 && (
              <label className="speed-toggle">
                <input type="checkbox" checked={showSpeed} onChange={(e) => setShowSpeed(e.target.checked)} />
                Show treadmill speed on chart
              </label>
            )}

            <HeartRateChart
              readings={includedReadings}
              averageBpm={stats?.average}
              typicalLowBpm={stats?.p025}
              typicalHighBpm={stats?.p975}
              speedEvents={chartSpeedEvents}
              speedUnit={speedUnit}
              showSpeed={showSpeed}
            />

            {session.sessionType === 'cardio' && (
              <SpeedEventsEditor
                sessionId={sessionId}
                session={session}
                speedEvents={speedEvents}
                onChange={load}
              />
            )}

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
