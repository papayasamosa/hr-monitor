import { describe, it, expect } from 'vitest';
import { buildCSV } from './csvExport';

function reading(timestamp, elapsedMs, heartRate) {
  return { timestamp, elapsedMs, heartRate };
}

describe('buildCSV', () => {
  const readings = [
    reading('2026-08-21T17:00:00.000Z', 0, 90),
    reading('2026-08-21T17:00:10.000Z', 10000, 95),
    reading('2026-08-21T17:00:20.000Z', 20000, 100)
  ];

  it('keeps the original four columns backwards-compatible when there is no speed data', () => {
    const csv = buildCSV(readings, 'cardio');
    const lines = csv.split('\n');
    expect(lines[0]).toBe('timestamp,elapsed_seconds,heart_rate_bpm,session_type,treadmill_speed,treadmill_speed_unit');
    expect(lines[1]).toBe('2026-08-21T17:00:00.000Z,0.000,90,cardio,,');
  });

  it('leaves treadmill_speed/treadmill_speed_unit blank for readings before the first speed event', () => {
    const csv = buildCSV(readings, 'cardio', {
      speedEvents: [{ recordedAt: '2026-08-21T17:00:15.000Z', speedCanonical: 6.0 }]
    });
    const lines = csv.split('\n');
    expect(lines[1]).toContain(',,'); // 17:00:00 - before the event
    expect(lines[2]).toContain(',,'); // 17:00:10 - before the event
    expect(lines[3]).toContain(',6,kmh'); // 17:00:20 - after the event
  });

  it('renders speed in the requested display unit, converting from the canonical km/h value', () => {
    const csv = buildCSV(readings, 'cardio', {
      speedEvents: [{ recordedAt: '2026-08-21T17:00:00.000Z', speedCanonical: 8.04672 }], // 5 mph canonical
      speedUnit: 'mph'
    });
    const lines = csv.split('\n');
    expect(lines[1]).toContain(',5,mph');
  });

  it('never repeats/interpolates a value not actually recorded - it holds the last active event until the next one', () => {
    const csv = buildCSV(readings, 'cardio', {
      speedEvents: [
        { recordedAt: '2026-08-21T17:00:00.000Z', speedCanonical: 5.0 },
        { recordedAt: '2026-08-21T17:00:10.000Z', speedCanonical: 6.0 }
      ]
    });
    const lines = csv.split('\n');
    expect(lines[1]).toContain(',5,kmh');
    expect(lines[2]).toContain(',6,kmh');
    expect(lines[3]).toContain(',6,kmh');
  });

  it('handles a null/missing session type the same as before', () => {
    const csv = buildCSV(readings, null);
    expect(csv.split('\n')[1]).toBe('2026-08-21T17:00:00.000Z,0.000,90,,,');
  });
});
