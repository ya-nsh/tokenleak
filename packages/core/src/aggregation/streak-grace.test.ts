import { describe, expect, it } from 'bun:test';
import type { DailyUsage } from '../types';
import { calculateStreaks } from './streaks';

function days(...dates: string[]): DailyUsage[] {
  return dates.map((date) => ({
    date,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2,
    cost: 0,
    models: [],
  }));
}

describe('calculateStreaks current-streak grace day', () => {
  it('keeps the streak alive while today has no usage yet', () => {
    expect(calculateStreaks(days('2026-10-31', '2026-11-01', '2026-11-02'), '2026-11-03')).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it('counts today when it is active', () => {
    expect(calculateStreaks(days('2026-11-02', '2026-11-03'), '2026-11-03').current).toBe(2);
  });

  it('breaks the streak after a full missed day', () => {
    expect(calculateStreaks(days('2026-10-31', '2026-11-01'), '2026-11-03').current).toBe(0);
  });

  it('survives month and year boundaries', () => {
    expect(calculateStreaks(days('2026-12-30', '2026-12-31', '2027-01-01'), '2027-01-02').current).toBe(3);
    expect(calculateStreaks(days('2026-01-31', '2026-02-01'), '2026-02-01').current).toBe(2);
  });

  it('counts repeated dates once instead of resetting', () => {
    expect(calculateStreaks(days('2026-11-01', '2026-11-01', '2026-11-02'), '2026-11-02')).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it('a single active yesterday is a 1-day streak', () => {
    expect(calculateStreaks(days('2026-11-02'), '2026-11-03').current).toBe(1);
  });

  it('no usage is no streak', () => {
    expect(calculateStreaks([], '2026-11-03')).toEqual({ current: 0, longest: 0 });
  });
});
