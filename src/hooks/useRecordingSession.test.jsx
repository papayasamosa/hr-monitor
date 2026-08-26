// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../services/session', () => ({
  default: {
    recoverInterruptedSessions: vi.fn().mockResolvedValue(),
    startRecording: vi.fn().mockResolvedValue('session-1'),
    recordReading: vi.fn(),
    stopRecording: vi.fn().mockResolvedValue()
  }
}));

const recordSpeedChange = vi.fn().mockResolvedValue({ id: 'evt-1' });
vi.mock('../services/session/speedEvents', () => ({
  recordSpeedChange: (...args) => recordSpeedChange(...args)
}));

vi.mock('../services/session/speedUnitPreference', () => ({
  getPreferredSpeedUnit: () => 'kmh',
  setPreferredSpeedUnit: vi.fn()
}));

import { useRecordingSession } from './useRecordingSession';

describe('useRecordingSession treadmill speed', () => {
  beforeEach(() => {
    recordSpeedChange.mockClear();
  });

  it('creates an initial speed event at recording start when a speed was set beforehand', async () => {
    const { result } = renderHook(() => useRecordingSession());

    act(() => result.current.setSessionType('cardio'));
    act(() => result.current.setTreadmillSpeed(5.5));

    await act(async () => {
      await result.current.startRecording('Test Device');
    });

    expect(recordSpeedChange).toHaveBeenCalledTimes(1);
    expect(recordSpeedChange).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ enteredValue: 5.5, enteredUnit: 'kmh' })
    );
  });

  it('does not create a speed event at start when no speed was set', async () => {
    const { result } = renderHook(() => useRecordingSession());
    act(() => result.current.setSessionType('cardio'));

    await act(async () => {
      await result.current.startRecording('Test Device');
    });

    expect(recordSpeedChange).not.toHaveBeenCalled();
  });

  it('a mid-recording speed change creates a new event via setTreadmillSpeed, not a rewrite of the first', async () => {
    const { result } = renderHook(() => useRecordingSession());
    act(() => result.current.setSessionType('cardio'));
    act(() => result.current.setTreadmillSpeed(5.0));

    await act(async () => {
      await result.current.startRecording('Test Device');
    });
    expect(recordSpeedChange).toHaveBeenCalledTimes(1);

    act(() => result.current.setTreadmillSpeed(6.0));

    expect(recordSpeedChange).toHaveBeenCalledTimes(2);
    expect(recordSpeedChange).toHaveBeenLastCalledWith(
      'session-1',
      expect.objectContaining({ enteredValue: 6.0, enteredUnit: 'kmh' })
    );
  });

  it('does not create a speed event when setTreadmillSpeed is called before recording starts', () => {
    const { result } = renderHook(() => useRecordingSession());
    act(() => result.current.setTreadmillSpeed(5.0));
    expect(recordSpeedChange).not.toHaveBeenCalled();
    expect(result.current.treadmillSpeedValue).toBe(5.0);
  });
});
