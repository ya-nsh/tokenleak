import type { ServiceTierUsage } from './types';

export function mergeServiceTiers(...groups: (ServiceTierUsage[] | undefined)[]): ServiceTierUsage[] {
  const tiers = new Map<string, ServiceTierUsage>();
  for (const group of groups) {
    for (const item of group ?? []) {
      const previous = tiers.get(item.tier);
      if (previous) {
        previous.tokens += item.tokens;
        previous.cost += item.cost;
        previous.unpricedTokens += item.unpricedTokens;
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
  return `${model} [${tiers.map(({ tier }) => labels[tier] ?? tier).join(', ')}]`;
}
