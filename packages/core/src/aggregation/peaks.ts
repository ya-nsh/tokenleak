import type { DailyUsage } from '../types';

/**
 * Returns the day with the highest totalTokens.
 * On ties, picks the most recent date.
 * Returns null for empty input.
 */
export function findPeakDay(
  daily: DailyUsage[],
): { date: string; tokens: number } | null {
  if (daily.length === 0) {
    return null;
  }

  let peak: { date: string; tokens: number } | null = null;

  for (const entry of daily) {
    if (
      peak === null ||
      entry.totalTokens > peak.tokens ||
      (entry.totalTokens === peak.tokens && entry.date > peak.date)
    ) {
      peak = { date: entry.date, tokens: entry.totalTokens };
    }
  }

  return peak;
}
