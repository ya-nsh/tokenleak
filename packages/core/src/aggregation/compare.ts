import type {
  DailyUsage,
  DateRange,
  CompareOutput,
  CompareDeltas,
  AggregatedStats,
} from '../types';
import { SCHEMA_VERSION } from '../constants';
import { ONE_DAY_MS, dateToUtcMs, formatDateStringUtc } from '../date-utils';
import { aggregate } from './aggregate';

/**
 * Filter daily usage entries to only those within the given date range (inclusive).
 */
function filterByRange(daily: DailyUsage[], range: DateRange): DailyUsage[] {
  return daily.filter((d) => d.date >= range.since && d.date <= range.until);
}

/**
 * Compute deltas between two aggregated stats periods (B minus A).
 */
export function computeDeltas(
  statsA: AggregatedStats,
  statsB: AggregatedStats,
): CompareDeltas {
  return {
    tokens: statsB.totalTokens - statsA.totalTokens,
    cost: statsB.totalCost - statsA.totalCost,
    streak: statsB.currentStreak - statsA.currentStreak,
    activeDays: statsB.activeDays - statsA.activeDays,
    averageDailyTokens:
      statsB.averageDailyTokens - statsA.averageDailyTokens,
    cacheHitRate: statsB.cacheHitRate - statsA.cacheHitRate,
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
  const sinceMs = dateToUtcMs(current.since);
  const untilMs = dateToUtcMs(current.until);
  const periodDays = Math.round((untilMs - sinceMs) / ONE_DAY_MS);

  const prevUntil = new Date(sinceMs - ONE_DAY_MS);
  const prevSince = new Date(prevUntil.getTime() - periodDays * ONE_DAY_MS);

  return {
    since: formatDateStringUtc(prevSince),
    until: formatDateStringUtc(prevUntil),
  };
}

/**
 * Compare two date ranges by aggregating each separately and computing deltas.
 *
 * @param daily - all daily usage data (will be filtered per range)
 * @param rangeA - the first (baseline) date range
 * @param rangeB - the second (comparison) date range
 * @returns CompareOutput with stats for each period and deltas (B - A)
 */
export function compareRanges(
  daily: DailyUsage[],
  rangeA: DateRange,
  rangeB: DateRange,
): CompareOutput {
  const dailyA = filterByRange(daily, rangeA);
  const dailyB = filterByRange(daily, rangeB);

  const statsA = aggregate(dailyA, rangeA.until);
  const statsB = aggregate(dailyB, rangeB.until);

  const deltas = computeDeltas(statsA, statsB);

  return {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    periodA: { range: rangeA, stats: statsA },
    periodB: { range: rangeB, stats: statsB },
    deltas,
  };
}
