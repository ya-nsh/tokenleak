import type { DailyUsage, TopModelEntry } from '../types';

const DEFAULT_LIMIT = 10;

/**
 * Aggregates model usage across all days, returns top N models by token count
 * with percentage of total.
 */
export function topModels(
  daily: DailyUsage[],
  limit: number = DEFAULT_LIMIT,
): TopModelEntry[] {
  const modelMap = new Map<string, { tokens: number; cost: number }>();

  for (const entry of daily) {
    for (const m of entry.models) {
      const existing = modelMap.get(m.model);
      if (existing) {
        existing.tokens += m.totalTokens;
        existing.cost += m.cost;
      } else {
        modelMap.set(m.model, { tokens: m.totalTokens, cost: m.cost });
      }
    }
  }

  let grandTotal = 0;
  for (const v of modelMap.values()) {
    grandTotal += v.tokens;
  }

  const entries: TopModelEntry[] = [];
  for (const [model, { tokens, cost }] of modelMap) {
    entries.push({
      model,
      tokens,
      cost,
      percentage: grandTotal > 0 ? tokens / grandTotal : 0,
    });
  }

  entries.sort((a, b) => b.tokens - a.tokens);

  return entries.slice(0, limit);
}
