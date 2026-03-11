import type { DailyUsage } from '../types';
import { ONE_DAY_MS, dateToUtcMs } from '../date-utils';

/**
 * Sums tokens and cost for the last N days from the reference date (inclusive).
 * Data outside the window is excluded.
 */
export function rollingWindow(
  daily: DailyUsage[],
  days: number,
  referenceDate: string,
): { tokens: number; cost: number } {
  if (daily.length === 0 || days <= 0) {
    return { tokens: 0, cost: 0 };
  }

  const refTime = dateToUtcMs(referenceDate);
  const windowStart = refTime - (days - 1) * ONE_DAY_MS;

  let tokens = 0;
  let cost = 0;

  for (const entry of daily) {
    const entryTime = dateToUtcMs(entry.date);
    if (entryTime >= windowStart && entryTime <= refTime) {
      tokens += entry.totalTokens;
      cost += entry.cost;
    }
  }

  return { tokens, cost };
}
