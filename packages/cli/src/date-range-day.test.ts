import { describe, expect, test } from 'bun:test';
import { getTodayLocal, shiftDateStringLocal } from '@tokenleak/core';
import { resolveDayArgument } from './date-range';

describe('resolveDayArgument', () => {
  test('passes real dates through', () => {
    expect(resolveDayArgument('tokenleak explain', '2026-02-28')).toBe('2026-02-28');
  });

  test('accepts leap days only in leap years', () => {
    expect(resolveDayArgument('x', '2028-02-29')).toBe('2028-02-29');
    expect(() => resolveDayArgument('x', '2026-02-29')).toThrow('is not a real calendar date');
  });

  test('resolves today and yesterday in local time, case-insensitively', () => {
    expect(resolveDayArgument('x', 'today')).toBe(getTodayLocal());
    expect(resolveDayArgument('x', 'Yesterday')).toBe(shiftDateStringLocal(getTodayLocal(), -1));
  });

  test('explains malformed input', () => {
    expect(() => resolveDayArgument('tokenleak replay', '3/10/2026')).toThrow(
      'tokenleak replay: "3/10/2026" is not in YYYY-MM-DD format. Use YYYY-MM-DD, "today", or "yesterday".',
    );
  });
});
