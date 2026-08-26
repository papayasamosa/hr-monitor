// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);

const loadSessionsInRange = vi.fn();
vi.mock('../services/analytics/loadAnalyticsData', () => ({
  loadSessionsInRange: (...args) => loadSessionsInRange(...args)
}));

import Dashboard from './Dashboard';

function session(overrides = {}) {
  const startedAt = overrides.startedAt || '2026-08-20T08:00:00.000Z';
  const endedAt = overrides.endedAt || new Date(new Date(startedAt).getTime() + 600000).toISOString();
  return {
    id: 'session-1',
    startedAt,
    endedAt,
    effectiveEndedAt: endedAt,
    durationMs: 600000,
    sessionType: 'cardio',
    status: 'completed',
    ...overrides
  };
}

function reading(elapsedMs, heartRate, baseIso) {
  return { timestamp: new Date(new Date(baseIso).getTime() + elapsedMs).toISOString(), elapsedMs, heartRate };
}

describe('Dashboard', () => {
  beforeEach(() => {
    loadSessionsInRange.mockReset();
  });

  it('shows an empty state when there are no sessions in range', async () => {
    loadSessionsInRange.mockResolvedValue([]);
    render(<Dashboard onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/no sessions in this range/i)).toBeTruthy());
  });

  it('renders summary cards and the daily chart from analytics data, without a treadmill section', async () => {
    const s = session({ id: 's1' });
    loadSessionsInRange.mockResolvedValue([
      { session: s, readings: [reading(0, 100, s.startedAt), reading(60000, 120, s.startedAt)], speedEvents: [] }
    ]);

    render(<Dashboard onBack={() => {}} />);

    await waitFor(() => expect(screen.getByText('Sessions')).toBeTruthy());
    expect(screen.getByText('1')).toBeTruthy(); // session count card
    expect(screen.getByText('Average HR')).toBeTruthy();
    expect(screen.getByText('Average heart rate by day')).toBeTruthy();
    expect(screen.queryByText('Heart rate by treadmill speed')).toBeNull();
  });

  it('shows treadmill sections when a session has speed events, with a speed selector for the trend section', async () => {
    const s = session({ id: 's-speed' });
    loadSessionsInRange.mockResolvedValue([
      {
        session: s,
        readings: [reading(0, 100, s.startedAt), reading(60000, 110, s.startedAt)],
        speedEvents: [{ recordedAt: s.startedAt, speedCanonical: 5.0 }]
      }
    ]);

    render(<Dashboard onBack={() => {}} />);

    await waitFor(() => expect(screen.getByText('Heart rate by treadmill speed')).toBeTruthy());
    expect(screen.getByText('Heart rate at the same speed over time')).toBeTruthy();
    expect(screen.getByRole('button', { name: '5 km/h' })).toBeTruthy();
  });

  it('reloads data when the date range filter changes', async () => {
    loadSessionsInRange.mockResolvedValue([]);
    render(<Dashboard onBack={() => {}} />);

    await waitFor(() => expect(loadSessionsInRange).toHaveBeenCalledWith({ days: 30, sessionType: 'all' }));

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));

    await waitFor(() => expect(loadSessionsInRange).toHaveBeenCalledWith({ days: 7, sessionType: 'all' }));
  });

  it('reloads data when the session type filter changes', async () => {
    loadSessionsInRange.mockResolvedValue([]);
    render(<Dashboard onBack={() => {}} />);

    await waitFor(() => expect(loadSessionsInRange).toHaveBeenCalledWith({ days: 30, sessionType: 'all' }));

    fireEvent.click(screen.getByRole('button', { name: 'Cardio' }));

    await waitFor(() => expect(loadSessionsInRange).toHaveBeenCalledWith({ days: 30, sessionType: 'cardio' }));
  });
});
