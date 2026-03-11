import { describe, expect, it } from 'bun:test';
import { computeDeltas, buildCompareOutput, parseCompareRange, computePreviousPeriod } from './compare';
import type { AggregatedStats, DateRange } from '../types';

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
    totalCost: 0,
    totalDays: 0,
    activeDays: 0,
    dayOfWeek: [],
    topModels: [],
    ...overrides,
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

    const deltas = computeDeltas(current, previous);

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

    const deltas = computeDeltas(current, previous);

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

    const deltas = computeDeltas(current, empty);

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
    expect(output.deltas.tokens).toBe(2_000);
    expect(output.deltas.cost).toBe(2.0);
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

    // 27 days in range, previous period should be 28 days earlier ending Jan 31
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
