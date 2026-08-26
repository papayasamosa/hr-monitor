// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);

const importSession = vi.fn();
vi.mock('../services/session/csvImport', async () => {
  const actual = await vi.importActual('../services/session/csvImport');
  return {
    ...actual,
    importSession: (...args) => importSession(...args)
  };
});

import CsvImportDialog from './CsvImportDialog';

function makeCsvFile(content, name = 'test.csv') {
  const file = new File([content], name, { type: 'text/csv' });
  return file;
}

const CURRENT_FORMAT_CSV = [
  'timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit',
  '2026-08-21T17:00:00.000Z,0.000,90,cardio,,',
  '2026-08-21T17:00:10.000Z,10.000,95,cardio,,'
].join('\n');

const NO_TYPE_CSV = [
  'timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit',
  '2026-08-22T09:00:00.000Z,0.000,80,,,'
].join('\n');

describe('CsvImportDialog', () => {
  it('shows a preview after choosing a valid CSV file', async () => {
    render(<CsvImportDialog onCancel={() => {}} onImported={() => {}} />);
    const input = screen.getByLabelText('Choose CSV file');

    fireEvent.change(input, { target: { files: [makeCsvFile(CURRENT_FORMAT_CSV)] } });

    await waitFor(() => expect(screen.getByText(/2 valid reading/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Import' })).not.toBeDisabled();
  });

  it('disables Import until a session type is chosen when the file has none', async () => {
    render(<CsvImportDialog onCancel={() => {}} onImported={() => {}} />);
    const input = screen.getByLabelText('Choose CSV file');

    fireEvent.change(input, { target: { files: [makeCsvFile(NO_TYPE_CSV)] } });

    await waitFor(() => expect(screen.getByText(/No session type/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Session type'), { target: { value: 'strength' } });
    expect(screen.getByRole('button', { name: 'Import' })).not.toBeDisabled();
  });

  it('calls importSession and reports the result on success', async () => {
    importSession.mockResolvedValue({ duplicate: false, sessionId: 'abc', readingCount: 2 });
    const onImported = vi.fn();
    render(<CsvImportDialog onCancel={() => {}} onImported={onImported} />);
    const input = screen.getByLabelText('Choose CSV file');

    fireEvent.change(input, { target: { files: [makeCsvFile(CURRENT_FORMAT_CSV)] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(screen.getByText(/Imported 2 reading/)).toBeTruthy());
    expect(onImported).toHaveBeenCalledWith('abc');
  });

  it('reports a duplicate import without calling onImported', async () => {
    importSession.mockResolvedValue({ duplicate: true, sessionId: 'existing-id' });
    const onImported = vi.fn();
    render(<CsvImportDialog onCancel={() => {}} onImported={onImported} />);
    const input = screen.getByLabelText('Choose CSV file');

    fireEvent.change(input, { target: { files: [makeCsvFile(CURRENT_FORMAT_CSV)] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(screen.getByText(/already imported/)).toBeTruthy());
    expect(onImported).not.toHaveBeenCalled();
  });
});
