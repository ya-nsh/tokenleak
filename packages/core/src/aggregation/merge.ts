import type { DailyUsage, ProviderData } from '../types';

/**
 * Merges daily data from multiple providers, combining entries for the same date.
 * Returns a single sorted array of DailyUsage.
 */
export function mergeProviderData(providers: ProviderData[]): DailyUsage[] {
  const dateMap = new Map<string, DailyUsage>();

  for (const provider of providers) {
    for (const entry of provider.daily) {
      const existing = dateMap.get(entry.date);
      if (existing) {
        existing.inputTokens += entry.inputTokens;
        existing.outputTokens += entry.outputTokens;
        existing.cacheReadTokens += entry.cacheReadTokens;
        existing.cacheWriteTokens += entry.cacheWriteTokens;
        existing.totalTokens += entry.totalTokens;
        existing.cost += entry.cost;
        existing.models = [...existing.models, ...entry.models];
      } else {
        dateMap.set(entry.date, {
          date: entry.date,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cacheReadTokens: entry.cacheReadTokens,
          cacheWriteTokens: entry.cacheWriteTokens,
          totalTokens: entry.totalTokens,
          cost: entry.cost,
          models: [...entry.models],
        });
      }
    }
  }

  return [...dateMap.values()].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}
