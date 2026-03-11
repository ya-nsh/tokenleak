import { describe, expect, it } from 'bun:test';
import { computeDeltas, buildCompareOutput, parseCompareRange, computePreviousPeriod, compareRanges } from './compare';
import type { AggregatedStats, DailyUsage, DateRange } from '../types';
import { SCHEMA_VERSION } from '../constants';

function makeStats(overrides: Partial<AggregatedStats> = {}): AggregatedStats {
  return {
    currentStreak: 0,
    longestStreak: 0,
    rolling30dTokens: 0,
    rolling30dCost: 0,
    rolling7dTokens: 0,
    rolling7dCost: 0,
    peakDay: null,
    averageDailyTokens: 0,
    averageDailyCost: 0,
    cacheHitRate: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    totalDays: 0,
    activeDays: 0,
    dayOfWeek: [],
    topModels: [],
    rolling30dTopModel: null,
    ...overrides,
  };
}

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

describe('computeDeltas', () => {
  it('computes positive deltas when current > previous', () => {
    const current = makeStats({
      totalTokens: 10_000,
      totalCost: 5.0,
      currentStreak: 7,
      activeDays: 20,
      averageDailyTokens: 500,
      cacheHitRate: 0.8,
    });
    const previous = makeStats({
      totalTokens: 5_000,
      totalCost: 2.5,
      currentStreak: 3,
      activeDays: 10,
      averageDailyTokens: 250,
      cacheHitRate: 0.4,
    });

    const deltas = computeDeltas(previous, current);

    expect(deltas.tokens).toBe(5_000);
    expect(deltas.cost).toBe(2.5);
    expect(deltas.streak).toBe(4);
    expect(deltas.activeDays).toBe(10);
    expect(deltas.averageDailyTokens).toBe(250);
    expect(deltas.cacheHitRate).toBeCloseTo(0.4);
  });

  it('computes negative deltas when current < previous', () => {
    const current = makeStats({
      totalTokens: 3_000,
      totalCost: 1.0,
      currentStreak: 2,
      activeDays: 5,
      averageDailyTokens: 100,
      cacheHitRate: 0.2,
    });
    const previous = makeStats({
      totalTokens: 8_000,
      totalCost: 4.0,
      currentStreak: 10,
      activeDays: 25,
      averageDailyTokens: 400,
      cacheHitRate: 0.9,
    });

    const deltas = computeDeltas(previous, current);

    expect(deltas.tokens).toBe(-5_000);
    expect(deltas.cost).toBe(-3.0);
    expect(deltas.streak).toBe(-8);
    expect(deltas.activeDays).toBe(-20);
    expect(deltas.averageDailyTokens).toBe(-300);
    expect(deltas.cacheHitRate).toBeCloseTo(-0.7);
  });

  it('computes zero deltas when periods are identical', () => {
    const stats = makeStats({
      totalTokens: 5_000,
      totalCost: 2.5,
      currentStreak: 5,
      activeDays: 15,
      averageDailyTokens: 300,
      cacheHitRate: 0.5,
    });

    const deltas = computeDeltas(stats, stats);

    expect(deltas.tokens).toBe(0);
    expect(deltas.cost).toBe(0);
    expect(deltas.streak).toBe(0);
    expect(deltas.activeDays).toBe(0);
    expect(deltas.averageDailyTokens).toBe(0);
    expect(deltas.cacheHitRate).toBe(0);
  });

  it('handles zeroed stats (no data period)', () => {
    const current = makeStats({
      totalTokens: 1_000,
      totalCost: 0.5,
      currentStreak: 1,
      activeDays: 3,
      averageDailyTokens: 50,
      cacheHitRate: 0.1,
    });
    const empty = makeStats();

    const deltas = computeDeltas(empty, current);

    expect(deltas.tokens).toBe(1_000);
    expect(deltas.cost).toBe(0.5);
    expect(deltas.streak).toBe(1);
    expect(deltas.activeDays).toBe(3);
    expect(deltas.averageDailyTokens).toBe(50);
    expect(deltas.cacheHitRate).toBeCloseTo(0.1);
  });

  it('handles both periods with no data', () => {
    const deltas = computeDeltas(makeStats(), makeStats());

    expect(deltas.tokens).toBe(0);
    expect(deltas.cost).toBe(0);
    expect(deltas.streak).toBe(0);
    expect(deltas.activeDays).toBe(0);
    expect(deltas.averageDailyTokens).toBe(0);
    expect(deltas.cacheHitRate).toBe(0);
  });
});

describe('buildCompareOutput', () => {
  it('produces a valid CompareOutput structure', () => {
    const rangeA: DateRange = { since: '2026-02-01', until: '2026-02-28' };
    const rangeB: DateRange = { since: '2026-01-01', until: '2026-01-31' };
    const statsA = makeStats({ totalTokens: 10_000, totalCost: 5.0 });
    const statsB = makeStats({ totalTokens: 8_000, totalCost: 3.0 });

    const output = buildCompareOutput(
      { range: rangeA, stats: statsA },
      { range: rangeB, stats: statsB },
    );

    expect(output.schemaVersion).toBe(1);
    expect(output.generated).toBeTruthy();
    expect(output.periodA.range).toEqual(rangeA);
    expect(output.periodB.range).toEqual(rangeB);
    expect(output.deltas.tokens).toBe(-2_000);
    expect(output.deltas.cost).toBe(-2.0);
  });
});

describe('parseCompareRange', () => {
  it('parses a valid range string', () => {
    const range = parseCompareRange('2026-01-01..2026-01-31');
    expect(range).toEqual({ since: '2026-01-01', until: '2026-01-31' });
  });

  it('returns null for missing separator', () => {
    expect(parseCompareRange('2026-01-01')).toBeNull();
  });

  it('returns null for invalid date format', () => {
    expect(parseCompareRange('01-01-2026..01-31-2026')).toBeNull();
  });

  it('returns null when since > until', () => {
    expect(parseCompareRange('2026-02-01..2026-01-01')).toBeNull();
  });

  it('accepts single-day range', () => {
    const range = parseCompareRange('2026-03-01..2026-03-01');
    expect(range).toEqual({ since: '2026-03-01', until: '2026-03-01' });
  });
});

describe('computePreviousPeriod', () => {
  it('computes the previous period of equal length', () => {
    const current: DateRange = { since: '2026-02-01', until: '2026-02-28' };
    const prev = computePreviousPeriod(current);

    expect(prev.until).toBe('2026-01-31');
    expect(prev.since).toBe('2026-01-04');
  });

  it('handles month boundary correctly', () => {
    const current: DateRange = { since: '2026-03-01', until: '2026-03-31' };
    const prev = computePreviousPeriod(current);

    expect(prev.until).toBe('2026-02-28');
  });

  it('handles single-day period', () => {
    const current: DateRange = { since: '2026-03-11', until: '2026-03-11' };
    const prev = computePreviousPeriod(current);

    expect(prev.until).toBe('2026-03-10');
    expect(prev.since).toBe('2026-03-10');
  });
});

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

    expect(result.deltas.tokens).toBe(12500 - 4500);
    expect(result.deltas.tokens).toBeGreaterThan(0);

    expect(result.deltas.cost).toBeCloseTo(1.25 - 0.45, 10);
    expect(result.deltas.cost).toBeGreaterThan(0);
  });

  it('negative delta when period B has lower usage than A', () => {
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

    expect(result.periodA.stats.totalTokens).toBe(0);
    expect(result.periodA.stats.totalCost).toBe(0);
    expect(result.periodA.stats.activeDays).toBe(0);
    expect(result.periodA.stats.currentStreak).toBe(0);

    expect(result.periodB.stats.totalTokens).toBe(12500);
    expect(result.periodB.stats.activeDays).toBe(4);

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
    expect(new Date(result.generated).getTime()).not.toBeNaN();
  });

  it('output preserves the range objects', () => {
    const result = compareRanges(daily, rangeA, rangeB);
    expect(result.periodA.range).toEqual(rangeA);
    expect(result.periodB.range).toEqual(rangeB);
  });

  it('deltas include activeDays difference', () => {
    const result = compareRanges(daily, rangeA, rangeB);
    expect(result.deltas.activeDays).toBe(4 - 3);
  });

  it('correctly filters data to each range', () => {
    const result = compareRanges(daily, rangeA, rangeB);

    expect(result.periodA.stats.totalTokens).toBe(4500);
    expect(result.periodB.stats.totalTokens).toBe(12500);
  });
});
