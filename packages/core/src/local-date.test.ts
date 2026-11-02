import { afterEach, describe, expect, test } from 'bun:test';
import { localDateOfTimestamp } from './date-utils';

const originalTz = process.env['TZ'];

afterEach(() => {
  process.env['TZ'] = originalTz;
});

describe('localDateOfTimestamp', () => {
  test('files work after local midnight under the local day east of UTC', () => {
    process.env['TZ'] = 'Asia/Kolkata';
    // 01:17 on Nov 3 in India is 19:47 on Nov 2 UTC.
    expect(localDateOfTimestamp('2026-11-02T19:47:00Z')).toBe('2026-11-03');
  });

  test('files late-evening work under the local day west of UTC', () => {
    process.env['TZ'] = 'America/Los_Angeles';
    // 18:00 on Nov 2 in Los Angeles is 01:00 on Nov 3 UTC.
    expect(localDateOfTimestamp('2026-11-03T01:00:00Z')).toBe('2026-11-02');
  });

  test('offset timestamps resolve to the same instant', () => {
    process.env['TZ'] = 'UTC';
    expect(localDateOfTimestamp('2026-11-03T01:00:00+05:30')).toBe('2026-11-02');
  });

  test('accepts epoch milliseconds and Date objects', () => {
    process.env['TZ'] = 'UTC';
    const millis = Date.parse('2026-02-28T23:59:59Z');
    expect(localDateOfTimestamp(millis)).toBe('2026-02-28');
    expect(localDateOfTimestamp(new Date(millis))).toBe('2026-02-28');
  });

  test('date-only strings are calendar days and never shift', () => {
    process.env['TZ'] = 'America/Los_Angeles';
    expect(localDateOfTimestamp('2026-03-10')).toBe('2026-03-10');
    expect(localDateOfTimestamp('2026-02-30')).toBeNull();
  });

  test('crosses month and year boundaries in local time', () => {
    process.env['TZ'] = 'Pacific/Auckland';
    expect(localDateOfTimestamp('2026-12-31T12:30:00Z')).toBe('2027-01-01');
  });

  test('unparseable input is null', () => {
    expect(localDateOfTimestamp('not a date')).toBeNull();
    expect(localDateOfTimestamp(Number.NaN)).toBeNull();
  });
});
