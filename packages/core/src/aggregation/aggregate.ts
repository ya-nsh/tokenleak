import type { AggregatedStats, DailyUsage } from '../types';
import { calculateStreaks } from './streaks';
import { rollingWindow } from './rolling-window';
import { findPeakDay } from './peaks';
import { dayOfWeekBreakdown } from './day-of-week';
import { cacheHitRate } from './cache-rate';
import { calculateAverages } from './averages';
import { topModels } from './top-models';

/**
 * Orchestrates all aggregation functions to produce AggregatedStats.
 * @param daily - merged daily usage data, sorted by date
 * @param referenceDate - the "today" date for rolling windows (YYYY-MM-DD)
 */
export function aggregate(
  daily: DailyUsage[],
  referenceDate: string,
): AggregatedStats {
  const streaks = calculateStreaks(daily);
  const rolling30 = rollingWindow(daily, 30, referenceDate);
  const rolling7 = rollingWindow(daily, 7, referenceDate);
  const peak = findPeakDay(daily);
  const dow = dayOfWeekBreakdown(daily);
  const cache = cacheHitRate(daily);
  const models = topModels(daily);

  let totalTokens = 0;
  let totalCost = 0;
  for (const entry of daily) {
    totalTokens += entry.totalTokens;
    totalCost += entry.cost;
  }

  const activeDays = daily.length;

  // Total days = span from first to last date + 1 (or 0 if no data)
  let totalDays = 0;
  if (daily.length > 0) {
    const sorted = [...daily].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const first = new Date(sorted[0]!.date).getTime();
    const last = new Date(sorted[sorted.length - 1]!.date).getTime();
    const ONE_DAY_MS = 86_400_000;
    totalDays = Math.round((last - first) / ONE_DAY_MS) + 1;
  }

  const averages = calculateAverages(daily, totalDays);

  return {
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    rolling30dTokens: rolling30.tokens,
    rolling30dCost: rolling30.cost,
    rolling7dTokens: rolling7.tokens,
    rolling7dCost: rolling7.cost,
    peakDay: peak,
    averageDailyTokens: averages.tokens,
    averageDailyCost: averages.cost,
    cacheHitRate: cache,
    totalTokens,
    totalCost,
    totalDays,
    activeDays,
    dayOfWeek: dow,
    topModels: models,
  };
}
