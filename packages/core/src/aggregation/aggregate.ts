import type { AggregatedStats, DailyUsage } from '../types';
import { ONE_DAY_MS, dateToUtcMs } from '../date-utils';
import { calculateStreaks } from './streaks';
import { rollingWindow } from './rolling-window';
import { findPeakDay } from './peaks';
import { dayOfWeekBreakdown } from './day-of-week';
import { cacheHitRate } from './cache-rate';
import { calculateAverages } from './averages';
import { topModels } from './top-models';

const ROLLING_WINDOW_DAYS = 30;

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
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  for (const entry of daily) {
    totalTokens += entry.totalTokens;
    totalInputTokens += entry.inputTokens;
    totalOutputTokens += entry.outputTokens;
    totalCost += entry.cost;
  }

  const rolling30dTopModel = computeRolling30dTopModel(daily, referenceDate);
  const activeDays = daily.length;
  const totalDays = computeTotalDays(daily);
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
    totalInputTokens,
    totalOutputTokens,
    totalCost,
    totalDays,
    activeDays,
    dayOfWeek: dow,
    topModels: models,
    rolling30dTopModel,
  };
}

/**
 * Find the most-used model in the rolling 30-day window.
 */
function computeRolling30dTopModel(
  daily: DailyUsage[],
  referenceDate: string,
): string | null {
  const refTime = dateToUtcMs(referenceDate);
  const windowStart = refTime - (ROLLING_WINDOW_DAYS - 1) * ONE_DAY_MS;
  const modelTokensMap = new Map<string, number>();

  for (const entry of daily) {
    const entryTime = dateToUtcMs(entry.date);
    if (entryTime >= windowStart && entryTime <= refTime) {
      for (const m of entry.models) {
        modelTokensMap.set(m.model, (modelTokensMap.get(m.model) ?? 0) + m.totalTokens);
      }
    }
  }

  let topModel: string | null = null;
  let maxTokens = 0;
  for (const [model, tokens] of modelTokensMap) {
    if (tokens > maxTokens) {
      maxTokens = tokens;
      topModel = model;
    }
  }

  return topModel;
}

/**
 * Compute total days spanned from first to last date + 1.
 */
function computeTotalDays(daily: DailyUsage[]): number {
  if (daily.length === 0) return 0;

  const sorted = [...daily].sort(
    (a, b) => dateToUtcMs(a.date) - dateToUtcMs(b.date),
  );
  const first = dateToUtcMs(sorted[0]!.date);
  const last = dateToUtcMs(sorted[sorted.length - 1]!.date);

  return Math.round((last - first) / ONE_DAY_MS) + 1;
}
