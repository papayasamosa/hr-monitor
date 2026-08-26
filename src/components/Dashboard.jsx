import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { loadSessionsInRange } from '../services/analytics/loadAnalyticsData';
import { getDailyHeartRateStats, getHeartRateBySpeed, getHeartRateAtSpeedOverTime } from '../services/analytics/heartRateAnalytics';
import { calculateHeartRateStats } from '../services/session/heartRateStats';
import { filterReadingsByEffectiveEnd } from '../services/session/sessionModel';

const DATE_RANGES = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 'all', label: 'All' }
];

const SESSION_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'cardio', label: 'Cardio' },
  { value: 'strength', label: 'Strength' }
];

function formatDuration(ms) {
  const totalMinutes = Math.round((ms || 0) / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDateLabel(dateKey) {
  const [, month, day] = dateKey.split('-');
  return `${month}/${day}`;
}

/**
 * Analytics dashboard: date-range + session-type filters, summary cards,
 * average-HR-by-day, and (only when any session in range recorded treadmill
 * speed) heart-rate-by-speed and heart-rate-at-the-same-speed-over-time.
 * All numbers come from services/analytics - nothing here recomputes a
 * statistic itself, so the values never depend on how the charts render.
 */
function Dashboard({ onBack }) {
  const [days, setDays] = useState(30);
  const [sessionTypeFilter, setSessionTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessionsData, setSessionsData] = useState([]);
  const [selectedSpeed, setSelectedSpeed] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await loadSessionsInRange({ days, sessionType: sessionTypeFilter });
      setSessionsData(data);
    } catch (err) {
      setError('Failed to load analytics: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [days, sessionTypeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const dailyStats = useMemo(() => getDailyHeartRateStats(sessionsData), [sessionsData]);

  const allIncludedReadings = useMemo(
    () => sessionsData.flatMap(({ session, readings }) => filterReadingsByEffectiveEnd(readings, session)),
    [sessionsData]
  );
  const overallStats = useMemo(() => calculateHeartRateStats(allIncludedReadings), [allIncludedReadings]);

  const totalDuration = useMemo(
    () => dailyStats.reduce((sum, d) => sum + d.totalDuration, 0),
    [dailyStats]
  );

  const hasTreadmillData = useMemo(
    () => sessionsData.some(({ speedEvents }) => speedEvents && speedEvents.length > 0),
    [sessionsData]
  );

  const speedStats = useMemo(
    () => (hasTreadmillData ? getHeartRateBySpeed(sessionsData) : []),
    [sessionsData, hasTreadmillData]
  );

  useEffect(() => {
    if (speedStats.length > 0 && (selectedSpeed === null || !speedStats.some((s) => s.speed === selectedSpeed))) {
      setSelectedSpeed(speedStats[0].speed);
    }
    if (speedStats.length === 0) setSelectedSpeed(null);
  }, [speedStats, selectedSpeed]);

  const trendData = useMemo(
    () => (selectedSpeed !== null ? getHeartRateAtSpeedOverTime(sessionsData, selectedSpeed) : []),
    [sessionsData, selectedSpeed]
  );

  const maxDailyAvg = Math.max(1, ...dailyStats.map((d) => d.averageBpm));
  const maxSpeedAvg = Math.max(1, ...speedStats.map((s) => s.averageBpm));
  const maxTrendAvg = Math.max(1, ...trendData.map((d) => d.averageBpm));

  return (
    <div className="hr-monitor dashboard-view">
      <header className="header header-with-back">
        <button className="back-link" onClick={onBack}>&larr; Back</button>
        <h1>Dashboard</h1>
      </header>

      <main className="main-content">
        {error && <div className="error-message">{error}</div>}

        <div className="dashboard-controls">
          <div className="dashboard-control-group">
            <span className="dashboard-control-label">Range</span>
            <div className="dashboard-pill-row">
              {DATE_RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={`dashboard-pill ${days === r.value ? 'selected' : ''}`}
                  onClick={() => setDays(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="dashboard-control-group">
            <span className="dashboard-control-label">Type</span>
            <div className="dashboard-pill-row">
              {SESSION_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`dashboard-pill ${sessionTypeFilter === f.value ? 'selected' : ''}`}
                  onClick={() => setSessionTypeFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && <p className="info-message">Loading analytics&hellip;</p>}

        {!loading && sessionsData.length === 0 && !error && (
          <p className="info-message">No sessions in this range.</p>
        )}

        {!loading && sessionsData.length > 0 && (
          <>
            <div className="stats-grid dashboard-summary-cards">
              <div className="stat-card">
                <div className="stat-label">Sessions</div>
                <div className="stat-value">{sessionsData.length}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Total duration</div>
                <div className="stat-value dashboard-stat-value-text">{formatDuration(totalDuration)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Average HR</div>
                <div className="stat-value">{overallStats ? Math.round(overallStats.average) : '—'}</div>
                <div className="stat-unit">BPM</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Typical range</div>
                <div className="stat-value dashboard-stat-value-text">
                  {overallStats ? `${Math.round(overallStats.p025)}–${Math.round(overallStats.p975)}` : '—'}
                </div>
                <div className="stat-unit">BPM</div>
              </div>
            </div>

            <section className="dashboard-section">
              <h2 className="dashboard-section-title">Average heart rate by day</h2>
              {dailyStats.length === 0 ? (
                <p className="info-message">No data in this range.</p>
              ) : (
                <div className="dashboard-bar-chart" role="img" aria-label="Average heart rate by day">
                  {dailyStats.map((d) => (
                    <div
                      key={d.date}
                      className="dashboard-bar-col"
                      title={`${d.date} • ${Math.round(d.averageBpm)} BPM avg • ${d.sessionCount} session(s) • ${formatDuration(d.totalDuration)}`}
                    >
                      <div
                        className="dashboard-bar"
                        style={{ height: `${Math.max(4, (d.averageBpm / maxDailyAvg) * 100)}%` }}
                      />
                      <span className="dashboard-bar-label">{formatDateLabel(d.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {hasTreadmillData && (
              <section className="dashboard-section">
                <h2 className="dashboard-section-title">Heart rate by treadmill speed</h2>
                <div className="dashboard-bar-chart" role="img" aria-label="Heart rate by treadmill speed">
                  {speedStats.map((s) => (
                    <div
                      key={s.speed}
                      className="dashboard-bar-col"
                      title={`${s.speed} km/h • ${Math.round(s.averageBpm)} BPM avg • ${s.readingCount} readings • ${s.sessionCount} session(s)`}
                    >
                      <div
                        className="dashboard-bar dashboard-bar-speed"
                        style={{ height: `${Math.max(4, (s.averageBpm / maxSpeedAvg) * 100)}%` }}
                      />
                      <span className="dashboard-bar-label">{s.speed}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {hasTreadmillData && (
              <section className="dashboard-section">
                <h2 className="dashboard-section-title">Heart rate at the same speed over time</h2>
                <div className="dashboard-pill-row">
                  {speedStats.map((s) => (
                    <button
                      key={s.speed}
                      type="button"
                      className={`dashboard-pill ${selectedSpeed === s.speed ? 'selected' : ''}`}
                      onClick={() => setSelectedSpeed(s.speed)}
                    >
                      {s.speed} km/h
                    </button>
                  ))}
                </div>
                {trendData.length === 0 ? (
                  <p className="info-message">No data at this speed in range.</p>
                ) : (
                  <div className="dashboard-bar-chart" role="img" aria-label="Heart rate at the same speed over time">
                    {trendData.map((d) => (
                      <div
                        key={d.date}
                        className="dashboard-bar-col"
                        title={`${d.date} • ${Math.round(d.averageBpm)} BPM avg at ${d.speed} km/h • ${formatDuration(d.durationAtSpeed)}`}
                      >
                        <div
                          className="dashboard-bar dashboard-bar-trend"
                          style={{ height: `${Math.max(4, (d.averageBpm / maxTrendAvg) * 100)}%` }}
                        />
                        <span className="dashboard-bar-label">{formatDateLabel(d.date)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default Dashboard;
export { formatDuration, formatDateLabel };
