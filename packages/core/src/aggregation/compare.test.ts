import { describe, expect, it } from 'bun:test';
import type { DailyUsage, DateRange } from '../types';
import { compareRanges } from './compare';
import { SCHEMA_VERSION } from '../constants';

function makeDailyUsage(
  date: string,
  totalTokens: number,
  cost: number,
): DailyUsage {
  return {
    date,
    inputTokens: Math.floor(totalTokens * 0.6),
    outputTokens: Math.floor(totalTokens * 0.4),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
    cost,
    models: [
      {
        model: 'claude-3-opus',
        inputTokens: Math.floor(totalTokens * 0.6),
        outputTokens: Math.floor(totalTokens * 0.4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens,
        cost,
      },
    ],
  };
}

describe('compareRanges', () => {
  const daily: DailyUsage[] = [
    // Period A data
    makeDailyUsage('2026-01-01', 1000, 0.1),
    makeDailyUsage('2026-01-02', 2000, 0.2),
    makeDailyUsage('2026-01-03', 1500, 0.15),
    // Period B data (higher usage)
    makeDailyUsage('2026-02-01', 3000, 0.3),
    makeDailyUsage('2026-02-02', 4000, 0.4),
    makeDailyUsage('2026-02-03', 3500, 0.35),
    makeDailyUsage('2026-02-04', 2000, 0.2),
  ];

  const rangeA: DateRange = { since: '2026-01-01', until: '2026-01-31' };
  const rangeB: DateRange = { since: '2026-02-01', until: '2026-02-28' };

  it('positive delta when period B has higher usage than A', () => {
    const result = compareRanges(daily, rangeA, rangeB);

    // Period A: 1000 + 2000 + 1500 = 4500 tokens
    // Period B: 3000 + 4000 + 3500 + 2000 = 12500 tokens
    expect(result.deltas.tokens).toBe(12500 - 4500);
    expect(result.deltas.tokens).toBeGreaterThan(0);

    // Cost: A = 0.45, B = 1.25
    expect(result.deltas.cost).toBeCloseTo(1.25 - 0.45, 10);
    expect(result.deltas.cost).toBeGreaterThan(0);
  });

  it('negative delta when period B has lower usage than A', () => {
    // Swap ranges so "B" is the lower-usage period
    const result = compareRanges(daily, rangeB, rangeA);

    expect(result.deltas.tokens).toBe(4500 - 12500);
    expect(result.deltas.tokens).toBeLessThan(0);

    expect(result.deltas.cost).toBeCloseTo(0.45 - 1.25, 10);
    expect(result.deltas.cost).toBeLessThan(0);
  });

  it('zero delta when both periods have equal data', () => {
    const equalDaily: DailyUsage[] = [
      makeDailyUsage('2026-01-01', 5000, 0.5),
      makeDailyUsage('2026-02-01', 5000, 0.5),
    ];

    const rA: DateRange = { since: '2026-01-01', until: '2026-01-31' };
    const rB: DateRange = { since: '2026-02-01', until: '2026-02-28' };

    const result = compareRanges(equalDaily, rA, rB);
    expect(result.deltas.tokens).toBe(0);
    expect(result.deltas.cost).toBeCloseTo(0, 10);
  });

  it('period with no data returns zeroed stats', () => {
    const emptyRange: DateRange = { since: '2025-01-01', until: '2025-01-31' };
    const result = compareRanges(daily, emptyRange, rangeB);

    // Period A has no data
    expect(result.periodA.stats.totalTokens).toBe(0);
    expect(result.periodA.stats.totalCost).toBe(0);
    expect(result.periodA.stats.activeDays).toBe(0);
    expect(result.periodA.stats.currentStreak).toBe(0);

    // Period B has data
    expect(result.periodB.stats.totalTokens).toBe(12500);
    expect(result.periodB.stats.activeDays).toBe(4);

    // Deltas should equal period B values (since A is zero)
    expect(result.deltas.tokens).toBe(12500);
  });

  it('both periods empty returns all-zero deltas', () => {
    const emptyA: DateRange = { since: '2025-01-01', until: '2025-01-31' };
    const emptyB: DateRange = { since: '2025-06-01', until: '2025-06-30' };
    const result = compareRanges(daily, emptyA, emptyB);

    expect(result.deltas.tokens).toBe(0);
    expect(result.deltas.cost).toBe(0);
    expect(result.deltas.streak).toBe(0);
    expect(result.deltas.activeDays).toBe(0);
    expect(result.deltas.averageDailyTokens).toBe(0);
    expect(result.deltas.cacheHitRate).toBe(0);
  });

  it('output has correct schema version', () => {
    const result = compareRanges(daily, rangeA, rangeB);
    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('output has generated timestamp', () => {
    const result = compareRanges(daily, rangeA, rangeB);
    expect(result.generated).toBeTruthy();
    // Should be a valid ISO string
    expect(new Date(result.generated).getTime()).not.toBeNaN();
  });

  it('output preserves the range objects', () => {
    const result = compareRanges(daily, rangeA, rangeB);
    expect(result.periodA.range).toEqual(rangeA);
    expect(result.periodB.range).toEqual(rangeB);
  });

  it('deltas include activeDays difference', () => {
    const result = compareRanges(daily, rangeA, rangeB);
    // A has 3 active days, B has 4 active days
    expect(result.deltas.activeDays).toBe(4 - 3);
  });

  it('correctly filters data to each range', () => {
    const result = compareRanges(daily, rangeA, rangeB);

    // Period A should only have Jan data
    expect(result.periodA.stats.totalTokens).toBe(4500);
    // Period B should only have Feb data
    expect(result.periodB.stats.totalTokens).toBe(12500);
  });
});
