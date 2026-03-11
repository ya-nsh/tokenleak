import type {
  DailyUsage,
  DateRange,
  CompareOutput,
  CompareDeltas,
  AggregatedStats,
} from '../types';
import { SCHEMA_VERSION } from '../constants';
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
function computeDeltas(
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
