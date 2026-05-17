import { describe, expect, it } from 'bun:test';
import { resolveRange } from './date-range';

describe('resolveRange', () => {
  it('computes an inclusive trailing range from days and until', () => {
    expect(resolveRange({ days: 7, until: '2026-03-14' })).toEqual({
      since: '2026-03-08',
      until: '2026-03-14',
    });
  });

  it('rejects non-positive day counts', () => {
    expect(() => resolveRange({ days: 0, until: '2026-03-14' })).toThrow(
      'days must be a positive number',
    );
  });

  it('rejects invalid calendar dates', () => {
    expect(() => resolveRange({ since: '2026-02-30', until: '2026-03-14' })).toThrow(
      'Invalid since date',
    );
    expect(() => resolveRange({ until: '2026-13-01' })).toThrow('Invalid until date');
  });

  it('rejects ranges where since is after until', () => {
    expect(() => resolveRange({ since: '2026-03-15', until: '2026-03-14' })).toThrow(
      'since must not be after until',
    );
  });
});
