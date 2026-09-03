import type { DailyUsage, ModelBreakdown, ProviderData } from '../types';
import { compareDateStrings } from '../date-utils';
import { mergeServiceTiers } from '../service-tiers';

/**
 * Merge model breakdowns by model name, accumulating token counts and cost.
 */
function mergeModelArrays(existing: ModelBreakdown[], incoming: ModelBreakdown[]): ModelBreakdown[] {
  const map = new Map<string, ModelBreakdown>();

  for (const m of existing) {
    map.set(m.model, { ...m });
  }

  for (const m of incoming) {
    const prev = map.get(m.model);
    if (prev) {
      const prevUnpriced = prev.unpricedTokens ?? 0;
      const incomingUnpriced = m.unpricedTokens ?? 0;
      const prevPriced = prev.pricedTokens ?? Math.max(0, prev.totalTokens - prevUnpriced);
      const incomingPriced = m.pricedTokens ?? Math.max(0, m.totalTokens - incomingUnpriced);
      prev.inputTokens += m.inputTokens;
      prev.outputTokens += m.outputTokens;
      prev.cacheReadTokens += m.cacheReadTokens;
      prev.cacheWriteTokens += m.cacheWriteTokens;
      prev.totalTokens += m.totalTokens;
      prev.cost += m.cost;
      prev.pricedTokens = prevPriced + incomingPriced;
      prev.unpricedTokens = prevUnpriced + incomingUnpriced;
      if (prev.serviceTiers || m.serviceTiers) prev.serviceTiers = mergeServiceTiers(prev.serviceTiers, m.serviceTiers);
      prev.costSource = prev.unpricedTokens >= prev.totalTokens ? 'unpriced' : prev.costSource;
      if (!prev.pricing && m.pricing) {
        prev.pricing = m.pricing;
      }
    } else {
      map.set(m.model, { ...m });
    }
  }

  return [...map.values()];
}

/**
 * Merges daily data from multiple providers, combining entries for the same date.
 * Models with the same name are aggregated (not duplicated).
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
        existing.models = mergeModelArrays(existing.models, entry.models);
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
    (a, b) => compareDateStrings(a.date, b.date),
  );
}
