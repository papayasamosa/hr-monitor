import React, { useCallback, useEffect, useMemo, useState } from 'react';
import storage from '../../services/storage';
import { exportSessionCSV } from '../../services/session/exportSession';
import { filterReadingsByEffectiveEnd } from '../../services/session/sessionModel';
import { calculateHeartRateStats } from '../../services/session/heartRateStats';
import { setEffectiveEndTime, restoreEffectiveEndTime } from '../../services/session/trimSession';
import { fromCanonicalKmh } from '../../services/session/speedUnits';
import { getPreferredSpeedUnit } from '../../services/session/speedUnitPreference';
import HeartRateChart from '../HeartRateChart';
import EditEndTimeDialog from '../EditEndTimeDialog';
import SpeedEventsEditor from '../SpeedEventsEditor';

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

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function AndroidSessionDetail({ sessionId, onBack }) {
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
    <div className="android-home">
      <header className="android-header android-header-with-back">
        <button className="back-link" onClick={onBack}>&larr; Back</button>
        <h1>Session Detail</h1>
      </header>

      <main className="android-main">
        {error && <div className="error-message">{error}</div>}
        {loading && <p className="info-message">Loading session...</p>}
        {!loading && !session && !error && <p className="info-message">Session not found.</p>}

        {!loading && session && (
          <>
            <div className="android-session-title">
              {session.sessionType ? capitalize(session.sessionType) : 'Session'}
            </div>
            <div className="android-session-timerange">
              {formatDateTime(session.startedAt)} &ndash; {formatDateTime(session.effectiveEndedAt || session.endedAt)}
            </div>
            <div className="android-session-duration">{formatDuration(session.durationMs)}</div>

            {isTrimmed && (
              <p className="trimmed-note">
                End time adjusted &middot; Originally recorded until {formatDateTime(session.endedAt)}
                {' '}
                <button className="link-btn" onClick={handleRestoreEndTime}>Restore</button>
              </p>
            )}

            <div className="android-stats-row android-stats-row-detail">
              <div className="android-stat">
                <span className="android-stat-value">{stats ? stats.min : '—'}</span>
                <span className="android-stat-label">Lowest</span>
              </div>
              <div className="android-stat">
                <span className="android-stat-value">{stats ? Math.round(stats.p025) : '—'}</span>
                <span className="android-stat-label">Typical low</span>
              </div>
              <div className="android-stat">
                <span className="android-stat-value">{stats ? Math.round(stats.average) : '—'}</span>
                <span className="android-stat-label">Average</span>
              </div>
              <div className="android-stat">
                <span className="android-stat-value">{stats ? Math.round(stats.p975) : '—'}</span>
                <span className="android-stat-label">Typical high</span>
              </div>
              <div className="android-stat">
                <span className="android-stat-value">{stats ? stats.max : '—'}</span>
                <span className="android-stat-label">Highest</span>
              </div>
              <div className="android-stat">
                <span className="android-stat-value">{session.readingCount}</span>
                <span className="android-stat-label">Readings</span>
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

            <div className="device-info-extended">
              <div className="device-info-row">
                <span className="device-info-row-label">Device</span>
                <span className="device-info-row-value">{session.deviceName || 'Unknown'}</span>
              </div>
              <div className="device-info-row">
                <span className="device-info-row-label">Status</span>
                <span className="device-info-row-value">{session.status}</span>
              </div>
            </div>

            <div className="android-device-actions">
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

export default AndroidSessionDetail;
