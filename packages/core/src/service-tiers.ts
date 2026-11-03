import type { ModelBreakdown, ServiceTierUsage } from './types';

/** Fill the portion of a model's usage for which its provider recorded no tier. */
export function completeServiceTiers(model: Pick<ModelBreakdown,
  'serviceTiers' | 'totalTokens' | 'cost' | 'unpricedTokens' | 'costSource'>): ServiceTierUsage[] {
  const tiers = mergeServiceTiers(model.serviceTiers);
  const missingTokens = model.totalTokens - tiers.reduce((sum, tier) => sum + tier.tokens, 0);
  if (missingTokens <= 0) return tiers;
  const unpriced = model.unpricedTokens ?? (model.costSource === 'unpriced' ? model.totalTokens : 0);
  return mergeServiceTiers(tiers, [{ tier: 'unknown', tokens: missingTokens,
    cost: Math.max(0, model.cost - tiers.reduce((sum, tier) => sum + tier.cost, 0)),
    unpricedTokens: Math.min(missingTokens, Math.max(0,
      unpriced - tiers.reduce((sum, tier) => sum + tier.unpricedTokens, 0))) }]);
}

export function mergeServiceTiers(...groups: (ServiceTierUsage[] | undefined)[]): ServiceTierUsage[] {
  const tiers = new Map<string, ServiceTierUsage>();
  for (const group of groups) {
    for (const item of group ?? []) {
      const previous = tiers.get(item.tier);
      if (previous) {
        previous.tokens += item.tokens;
        previous.cost += item.cost;
        previous.unpricedTokens += item.unpricedTokens;
        if (item.configuredTokens) previous.configuredTokens = (previous.configuredTokens ?? 0) + item.configuredTokens;
      } else {
        tiers.set(item.tier, { ...item });
      }
    }
  }
  return [...tiers.values()].sort((a, b) => a.tier.localeCompare(b.tier));
}

export function formatModelWithTier(model: string, tiers?: ServiceTierUsage[]): string {
  if (!tiers?.length) return model;
  const labels: Record<string, string> = { default: 'Standard', fast: 'Fast', unknown: 'tier unknown',
    auto: 'Auto tier', flex: 'Flex', ultrafast: 'Ultrafast' };
  // A tier known only from settings is labelled as such, never as recorded.
  const describe = ({ tier, tokens, configuredTokens }: ServiceTierUsage): string => {
    const label = labels[tier] ?? tier;
    return tokens > 0 && (configuredTokens ?? 0) >= tokens ? `${label} (config)` : label;
  };
  return `${model} [${tiers.map(describe).join(', ')}]`;
}
