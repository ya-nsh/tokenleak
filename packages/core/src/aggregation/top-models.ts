import type { DailyUsage, TopModelEntry, ServiceTierUsage } from '../types';
import { completeServiceTiers, mergeServiceTiers } from '../service-tiers';

const DEFAULT_LIMIT = 10;

/**
 * Aggregates model usage across all days, returns top N models by token count
 * with percentage share of total in the 0..100 range.
 */
export function topModels(
  daily: DailyUsage[],
  limit: number = DEFAULT_LIMIT,
): TopModelEntry[] {
  const modelMap = new Map<string, { tokens: number; cost: number; unpriced: number; tiers?: ServiceTierUsage[] }>();

  for (const entry of daily) {
    for (const m of entry.models) {
      const unpriced = Math.min(m.totalTokens, Math.max(0,
        m.unpricedTokens ?? (m.costSource === 'unpriced' ? m.totalTokens : 0)));
      const existing = modelMap.get(m.model);
      if (existing) {
        if (existing.tiers || m.serviceTiers) {
          existing.tiers = mergeServiceTiers(completeServiceTiers({ serviceTiers: existing.tiers,
            totalTokens: existing.tokens, cost: existing.cost, unpricedTokens: existing.unpriced }),
          completeServiceTiers(m));
        }
        existing.tokens += m.totalTokens;
        existing.cost += m.cost;
        existing.unpriced += unpriced;
      } else {
        modelMap.set(m.model, { tokens: m.totalTokens, cost: m.cost, unpriced,
          tiers: m.serviceTiers ? completeServiceTiers(m) : undefined });
      }
    }
  }

  let grandTotal = 0;
  for (const v of modelMap.values()) {
    grandTotal += v.tokens;
  }

  const entries: TopModelEntry[] = [];
  for (const [model, { tokens, cost, unpriced, tiers }] of modelMap) {
    entries.push({
      model,
      tokens,
      cost,
      percentage: grandTotal > 0 ? (tokens / grandTotal) * 100 : 0,
      costCompleteness: { status: unpriced === 0 ? 'complete' : unpriced === tokens ? 'unknown' : 'partial',
        totalTokens: tokens, pricedTokens: tokens - unpriced, unpricedTokens: unpriced,
        unknownModels: unpriced > 0 ? [model] : [] },
      ...(tiers ? { serviceTiers: tiers } : {}),
    });
  }

  entries.sort((a, b) => b.tokens - a.tokens);

  return entries.slice(0, limit);
}
