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
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  for (const entry of daily) {
    totalTokens += entry.totalTokens;
    totalInputTokens += entry.inputTokens;
    totalOutputTokens += entry.outputTokens;
    totalCost += entry.cost;
  }

  // Compute most-used model in the 30-day rolling window
  const refTime = new Date(referenceDate + 'T00:00:00Z').getTime();
  const windowStart = refTime - 29 * 86_400_000;
  const modelTokensMap = new Map<string, number>();
  for (const entry of daily) {
    const entryTime = new Date(entry.date + 'T00:00:00Z').getTime();
    if (entryTime >= windowStart && entryTime <= refTime) {
      for (const m of entry.models) {
        modelTokensMap.set(m.model, (modelTokensMap.get(m.model) ?? 0) + m.totalTokens);
      }
    }
  }
  let rolling30dTopModel: string | null = null;
  let maxModelTokens = 0;
  for (const [model, tokens] of modelTokensMap) {
    if (tokens > maxModelTokens) {
      maxModelTokens = tokens;
      rolling30dTopModel = model;
    }
  }

  const activeDays = daily.length;

  // Total days = span from first to last date + 1 (or 0 if no data)
  let totalDays = 0;
  if (daily.length > 0) {
    const sorted = [...daily].sort(
      (a, b) => new Date(a.date + 'T00:00:00Z').getTime() - new Date(b.date + 'T00:00:00Z').getTime(),
    );
    const first = new Date(sorted[0]!.date + 'T00:00:00Z').getTime();
    const last = new Date(sorted[sorted.length - 1]!.date + 'T00:00:00Z').getTime();
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
