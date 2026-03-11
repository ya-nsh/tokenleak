import type { DailyUsage } from '../types';

/**
 * Returns 0-1 ratio of cacheReadTokens / (inputTokens + cacheReadTokens).
 * Returns 0 if denominator is 0.
 */
export function cacheHitRate(daily: DailyUsage[]): number {
  let totalCacheRead = 0;
  let totalInput = 0;

  for (const entry of daily) {
    totalCacheRead += entry.cacheReadTokens;
    totalInput += entry.inputTokens;
  }

  const denominator = totalInput + totalCacheRead;
  if (denominator === 0) {
    return 0;
  }

  return totalCacheRead / denominator;
}
