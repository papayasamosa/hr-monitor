// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);

const recordSpeedChange = vi.fn();
const updateSpeedEvent = vi.fn();
const deleteSpeedEvent = vi.fn();
vi.mock('../services/session/speedEvents', () => ({
  recordSpeedChange: (...args) => recordSpeedChange(...args),
  updateSpeedEvent: (...args) => updateSpeedEvent(...args),
  deleteSpeedEvent: (...args) => deleteSpeedEvent(...args)
}));

import SpeedEventsEditor from './SpeedEventsEditor';

const session = {
  id: 's1',
  startedAt: '2026-08-21T17:00:00.000Z',
  endedAt: '2026-08-21T18:00:00.000Z',
  effectiveEndedAt: '2026-08-21T18:00:00.000Z'
};

describe('SpeedEventsEditor', () => {
  it('shows an empty state when there are no speed events yet', () => {
    render(<SpeedEventsEditor sessionId="s1" session={session} speedEvents={[]} onChange={() => {}} />);
    expect(screen.getByText(/No speed events recorded/)).toBeTruthy();
  });

  it('lists existing events with their time and value', () => {
    render(
      <SpeedEventsEditor
        sessionId="s1"
        session={session}
        speedEvents={[
          { id: 'e1', recordedAt: '2026-08-21T17:00:00.000Z', speedCanonical: 5, enteredValue: 5, enteredUnit: 'kmh' }
        ]}
        onChange={() => {}}
      />
    );
    expect(screen.getByText('5 kmh')).toBeTruthy();
  });

  it('rejects adding an event outside the session window', () => {
    render(<SpeedEventsEditor sessionId="s1" session={session} speedEvents={[]} onChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add speed event' }));
    // Set a time before the session started.
    const timeInput = screen.getByDisplayValue(/2026-08-21T/);
    fireEvent.change(timeInput, { target: { value: '2026-08-21T16:00:00' } });
    fireEvent.change(screen.getByPlaceholderText('Speed'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/must be within the recorded session/i)).toBeTruthy();
    expect(recordSpeedChange).not.toHaveBeenCalled();
  });

  it('adds a valid speed event within the session window', async () => {
    recordSpeedChange.mockResolvedValue({ id: 'new-evt' });
    const onChange = vi.fn();
    render(<SpeedEventsEditor sessionId="s1" session={session} speedEvents={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add speed event' }));
    fireEvent.change(screen.getByPlaceholderText('Speed'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(recordSpeedChange).toHaveBeenCalledWith('s1', expect.objectContaining({ enteredValue: 6 })));
    expect(onChange).toHaveBeenCalled();
  });

  it('deletes an event after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteSpeedEvent.mockResolvedValue();
    const onChange = vi.fn();
    render(
      <SpeedEventsEditor
        sessionId="s1"
        session={session}
        speedEvents={[
          { id: 'e1', recordedAt: '2026-08-21T17:00:00.000Z', speedCanonical: 5, enteredValue: 5, enteredUnit: 'kmh' }
        ]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => expect(deleteSpeedEvent).toHaveBeenCalledWith('e1'));
    expect(onChange).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
