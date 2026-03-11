import type { DailyUsage } from '../types';

/**
 * Average daily tokens and cost over the total period.
 * If totalDays is 0, returns zeroed averages.
 */
export function calculateAverages(
  daily: DailyUsage[],
  totalDays: number,
): { tokens: number; cost: number } {
  if (totalDays <= 0 || daily.length === 0) {
    return { tokens: 0, cost: 0 };
  }

  let totalTokens = 0;
  let totalCost = 0;

  for (const entry of daily) {
    totalTokens += entry.totalTokens;
    totalCost += entry.cost;
  }

  return {
    tokens: totalTokens / totalDays,
    cost: totalCost / totalDays,
  };
}
