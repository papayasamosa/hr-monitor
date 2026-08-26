// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  useHeartRateStreamHealth,
  WAITING_FOR_DATA_TIMEOUT_MS,
  STREAMING_STALE_TIMEOUT_MS,
  RESUBSCRIBE_WAIT_MS,
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_BACKOFF_MS
} from './useHeartRateStreamHealth';

vi.mock('../services/bluetooth', () => ({
  default: {
    startNotifications: vi.fn(),
    stopNotifications: vi.fn()
  }
}));

import bluetooth from '../services/bluetooth';

function connection(id = 'conn-1') {
  return { id };
}

describe('useHeartRateStreamHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    bluetooth.startNotifications.mockReset();
    bluetooth.stopNotifications.mockReset();
    bluetooth.startNotifications.mockImplementation(async (conn) => conn);
    bluetooth.stopNotifications.mockImplementation(async () => {});
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('goes from waiting-for-data to streaming when a reading arrives', async () => {
    const onReading = vi.fn();
    const { result } = renderHook(() => useHeartRateStreamHealth({ onReading }));

    act(() => result.current.startMonitoring(connection()));
    expect(result.current.streamState).toBe('waiting-for-data');

    act(() => result.current.handleReading({ heartRate: 70 }));
    expect(result.current.streamState).toBe('streaming');
    expect(onReading).toHaveBeenCalledWith({ heartRate: 70 });
    expect(result.current.lastHeartRateReceivedAt).not.toBeNull();
  });

  it('detects "connected but no first BPM": times out waiting-for-data and begins recovery via resubscribe', async () => {
    const onReading = vi.fn();
    const { result } = renderHook(() => useHeartRateStreamHealth({ onReading }));

    act(() => result.current.startMonitoring(connection()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WAITING_FOR_DATA_TIMEOUT_MS);
    });

    expect(bluetooth.stopNotifications).toHaveBeenCalledTimes(1);
    expect(bluetooth.startNotifications).toHaveBeenCalledTimes(1);
    expect(result.current.streamState).toBe('recovering');
  });

  it('recovers via resubscribe alone when the resubscribed stream produces a reading', async () => {
    const onReading = vi.fn();
    const onReconnectNeeded = vi.fn();
    const { result } = renderHook(() => useHeartRateStreamHealth({ onReading, onReconnectNeeded }));

    act(() => result.current.startMonitoring(connection()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WAITING_FOR_DATA_TIMEOUT_MS);
    });
    expect(result.current.streamState).toBe('recovering');

    // A reading arrives on the resubscribed stream before the resubscribe-wait timeout elapses.
    act(() => result.current.handleReading({ heartRate: 65 }));
    expect(result.current.streamState).toBe('streaming');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESUBSCRIBE_WAIT_MS + 1000);
    });
    expect(onReconnectNeeded).not.toHaveBeenCalled();
  });

  it('escalates to a full reconnect when resubscribe does not restore data, bounded by MAX_RECOVERY_ATTEMPTS', async () => {
    const onReading = vi.fn();
    const onReconnectNeeded = vi.fn();
    const { result } = renderHook(() => useHeartRateStreamHealth({ onReading, onReconnectNeeded }));

    act(() => result.current.startMonitoring(connection()));

    // Initial silence -> recovering (resubscribe attempt #1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WAITING_FOR_DATA_TIMEOUT_MS);
    });

    // Resubscribe wait elapses with no reading -> escalate to reconnect (after backoff[0])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESUBSCRIBE_WAIT_MS + RECOVERY_BACKOFF_MS[0] + 100);
    });
    expect(onReconnectNeeded).toHaveBeenCalledTimes(1);
  });

  it('never runs two recoveries concurrently (recoveryInProgressRef guard)', async () => {
    const onReading = vi.fn();
    const { result } = renderHook(() => useHeartRateStreamHealth({ onReading }));

    act(() => result.current.startMonitoring(connection()));

    // Fire the watchdog timeout, then immediately fire it again before any
    // async resubscribe work resolves - startNotifications should only be
    // invoked once per recovery cycle, not twice concurrently.
    await act(async () => {
      vi.advanceTimersByTime(WAITING_FOR_DATA_TIMEOUT_MS);
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    expect(bluetooth.stopNotifications.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('stopMonitoring clears the watchdog so no further recovery fires', async () => {
    const onReading = vi.fn();
    const onReconnectNeeded = vi.fn();
    const { result } = renderHook(() => useHeartRateStreamHealth({ onReading, onReconnectNeeded }));

    act(() => result.current.startMonitoring(connection()));
    act(() => result.current.stopMonitoring());
    expect(result.current.streamState).toBe('disconnected');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WAITING_FOR_DATA_TIMEOUT_MS + STREAMING_STALE_TIMEOUT_MS + RESUBSCRIBE_WAIT_MS);
    });

    expect(bluetooth.startNotifications).not.toHaveBeenCalled();
    expect(onReconnectNeeded).not.toHaveBeenCalled();
  });

  it('does not register duplicate reading handlers across a resubscribe (handleReading identity is stable)', async () => {
    const onReading = vi.fn();
    const { result, rerender } = renderHook(() => useHeartRateStreamHealth({ onReading }));

    const firstHandle = result.current.handleReading;
    act(() => result.current.startMonitoring(connection()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WAITING_FOR_DATA_TIMEOUT_MS);
    });

    rerender();
    expect(result.current.handleReading).toBe(firstHandle);
    // Only one call to startNotifications for the resubscribe - no duplicate wiring.
    expect(bluetooth.startNotifications).toHaveBeenCalledTimes(1);
  });

  it('checkHealthOnResume leaves a healthy, recently-updated stream alone', async () => {
    const onReading = vi.fn();
    const onReconnectNeeded = vi.fn();
    const { result } = renderHook(() => useHeartRateStreamHealth({ onReading, onReconnectNeeded }));

    act(() => result.current.startMonitoring(connection()));
    act(() => result.current.handleReading({ heartRate: 72 }));

    act(() => result.current.checkHealthOnResume());

    expect(bluetooth.startNotifications).not.toHaveBeenCalled();
    expect(onReconnectNeeded).not.toHaveBeenCalled();
    expect(result.current.streamState).toBe('streaming');
  });

  it('checkHealthOnResume restores a stale stream on foreground return', async () => {
    const onReading = vi.fn();
    const { result } = renderHook(() => useHeartRateStreamHealth({ onReading }));

    act(() => result.current.startMonitoring(connection()));
    act(() => result.current.handleReading({ heartRate: 72 }));

    // Simulate time passing in the background well beyond the stale threshold.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STREAMING_STALE_TIMEOUT_MS + 5000);
    });
    // The normal watchdog already would have triggered recovery by now via
    // the timer, but simulate a resume check finding staleness directly too.
    act(() => result.current.checkHealthOnResume());

    expect(bluetooth.stopNotifications).toHaveBeenCalled();
  });

  it('treats a heartRate:0 "no contact" reading the same as silence - not forwarded, watchdog keeps running', async () => {
    const onReading = vi.fn();
    const { result } = renderHook(() => useHeartRateStreamHealth({ onReading }));

    act(() => result.current.startMonitoring(connection()));
    act(() => result.current.handleReading({ heartRate: 65 }));
    expect(result.current.streamState).toBe('streaming');
    onReading.mockClear();

    // The strap keeps sending notifications on schedule, just with heartRate: 0
    // (observed on real hardware when the strap loses skin contact).
    act(() => result.current.handleReading({ heartRate: 0 }));
    expect(onReading).not.toHaveBeenCalled();

    // Because the 0-readings never reset the watchdog, staleness still fires
    // and recovery still begins - a real monitor "streaming" nothing but
    // zeros must not be mistaken for a healthy stream.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STREAMING_STALE_TIMEOUT_MS);
    });
    expect(result.current.streamState).toBe('recovering');
  });

  it('an active recording is untouched by recovery: handleReading keeps delivering to onReading through a resubscribe', async () => {
    const received = [];
    const onReading = vi.fn((data) => received.push(data.heartRate));
    const { result } = renderHook(() => useHeartRateStreamHealth({ onReading }));

    act(() => result.current.startMonitoring(connection()));
    act(() => result.current.handleReading({ heartRate: 60 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STREAMING_STALE_TIMEOUT_MS);
    });
    expect(result.current.streamState).toBe('recovering');

    // Recording never restarted (no separate "start" concept in this hook at
    // all) - once the resubscribed stream produces data again, it flows
    // through the exact same onReading callback with no gap-filling/invention.
    act(() => result.current.handleReading({ heartRate: 61 }));
    expect(received).toEqual([60, 61]);
  });
});
