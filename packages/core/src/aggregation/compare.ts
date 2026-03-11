import type { AggregatedStats, CompareDeltas, CompareOutput, DateRange } from '../types';
import { SCHEMA_VERSION } from '../constants';

/**
 * Compute deltas between two aggregated stats periods.
 * Positive deltas mean periodA (current) is higher than periodB (previous).
 */
export function computeDeltas(
  current: AggregatedStats,
  previous: AggregatedStats,
): CompareDeltas {
  return {
    tokens: current.totalTokens - previous.totalTokens,
    cost: current.totalCost - previous.totalCost,
    streak: current.currentStreak - previous.currentStreak,
    activeDays: current.activeDays - previous.activeDays,
    averageDailyTokens: current.averageDailyTokens - previous.averageDailyTokens,
    cacheHitRate: current.cacheHitRate - previous.cacheHitRate,
  };
}

/**
 * Build a full CompareOutput from two periods' stats and date ranges.
 */
export function buildCompareOutput(
  periodA: { range: DateRange; stats: AggregatedStats },
  periodB: { range: DateRange; stats: AggregatedStats },
): CompareOutput {
  return {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    periodA,
    periodB,
    deltas: computeDeltas(periodA.stats, periodB.stats),
  };
}

/**
 * Parse a compare range string like "YYYY-MM-DD..YYYY-MM-DD" into a DateRange.
 * Returns null if the format is invalid.
 */
export function parseCompareRange(rangeStr: string): DateRange | null {
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const parts = rangeStr.split('..');
  if (parts.length !== 2) return null;

  const [since, until] = parts as [string, string];
  if (!DATE_PATTERN.test(since) || !DATE_PATTERN.test(until)) return null;

  if (since > until) return null;

  return { since, until };
}

/**
 * Compute the previous period date range given a current period.
 * The previous period has the same length and ends the day before the current period starts.
 */
export function computePreviousPeriod(current: DateRange): DateRange {
  const ONE_DAY_MS = 86_400_000;
  const sinceMs = new Date(current.since).getTime();
  const untilMs = new Date(current.until).getTime();
  const periodDays = Math.round((untilMs - sinceMs) / ONE_DAY_MS);

  const prevUntil = new Date(sinceMs - ONE_DAY_MS);
  const prevSince = new Date(prevUntil.getTime() - periodDays * ONE_DAY_MS);

  return {
    since: prevSince.toISOString().slice(0, 10),
    until: prevUntil.toISOString().slice(0, 10),
  };
}
