import { describe, it, expect } from 'vitest';
import { createSpeedEventRecord, speedForReading, createSpeedResolver } from './speedEventModel';
import { toCanonicalKmh, fromCanonicalKmh, normalizeSpeed } from './speedUnits';

describe('speedUnits conversions', () => {
  it('converts mph to km/h canonical and back losslessly (within normalization precision)', () => {
    const kmh = toCanonicalKmh(5, 'mph');
    expect(kmh).toBeCloseTo(8.05, 1);
    expect(fromCanonicalKmh(kmh, 'mph')).toBeCloseTo(5, 2);
  });

  it('keeps km/h input unchanged (identity conversion)', () => {
    expect(toCanonicalKmh(6.5, 'kmh')).toBe(6.5);
    expect(fromCanonicalKmh(6.5, 'kmh')).toBe(6.5);
  });

  it('normalizes floating-point noise so near-identical speeds compare equal', () => {
    expect(normalizeSpeed(5.499999999)).toBe(normalizeSpeed(5.5));
    expect(normalizeSpeed(5.500000001)).toBe(normalizeSpeed(5.5));
  });
});

describe('createSpeedEventRecord', () => {
  it('builds a record with a canonical km/h speed derived from the entered value/unit', () => {
    const event = createSpeedEventRecord({
      sessionId: 's1',
      recordedAt: '2026-08-21T17:00:00.000Z',
      enteredValue: 5,
      enteredUnit: 'mph'
    });
    expect(event.sessionId).toBe('s1');
    expect(event.enteredValue).toBe(5);
    expect(event.enteredUnit).toBe('mph');
    expect(event.speedCanonical).toBeCloseTo(8.05, 1);
    expect(event.id).toBeTruthy();
  });
});

describe('speedForReading', () => {
  const events = [
    { recordedAt: '2026-08-21T17:00:00.000Z', speedCanonical: 5 },
    { recordedAt: '2026-08-21T17:10:00.000Z', speedCanonical: 5.5 },
    { recordedAt: '2026-08-21T17:20:00.000Z', speedCanonical: 6 }
  ];

  it('returns null for a timestamp before the first event (no speed invented)', () => {
    expect(speedForReading(events, '2026-08-21T16:59:00.000Z')).toBeNull();
  });

  it('returns null when there are no events at all', () => {
    expect(speedForReading([], '2026-08-21T17:05:00.000Z')).toBeNull();
  });

  it('returns the most recent event at-or-before the timestamp', () => {
    expect(speedForReading(events, '2026-08-21T17:00:00.000Z')).toBe(5);
    expect(speedForReading(events, '2026-08-21T17:05:00.000Z')).toBe(5);
    expect(speedForReading(events, '2026-08-21T17:10:00.000Z')).toBe(5.5);
    expect(speedForReading(events, '2026-08-21T17:25:00.000Z')).toBe(6);
  });

  it('works regardless of input event order', () => {
    const shuffled = [events[2], events[0], events[1]];
    expect(speedForReading(shuffled, '2026-08-21T17:15:00.000Z')).toBe(5.5);
  });
});

describe('createSpeedResolver', () => {
  const events = [
    { recordedAt: '2026-08-21T17:00:00.000Z', speedCanonical: 5 },
    { recordedAt: '2026-08-21T17:10:00.000Z', speedCanonical: 5.5 },
    { recordedAt: '2026-08-21T17:20:00.000Z', speedCanonical: 6 }
  ];

  it('resolves a monotonic sequence of timestamps matching speedForReading', () => {
    const resolve = createSpeedResolver(events);
    const timestamps = [
      '2026-08-21T16:55:00.000Z',
      '2026-08-21T17:00:00.000Z',
      '2026-08-21T17:05:00.000Z',
      '2026-08-21T17:10:00.000Z',
      '2026-08-21T17:15:00.000Z',
      '2026-08-21T17:25:00.000Z'
    ];
    const resolved = timestamps.map(resolve);
    const expected = timestamps.map((t) => speedForReading(events, t));
    expect(resolved).toEqual(expected);
  });

  it('handles an empty event list', () => {
    const resolve = createSpeedResolver([]);
    expect(resolve('2026-08-21T17:00:00.000Z')).toBeNull();
  });
});
