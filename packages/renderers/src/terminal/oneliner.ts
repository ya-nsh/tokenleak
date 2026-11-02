import { formatCostWithCompleteness } from '@tokenleak/core';
import type { ProviderData, TokenleakOutput, RenderOptions } from '@tokenleak/core';
import { formatTokenCount } from '@tokenleak/core';

function countActiveProviders(providers: ProviderData[]): number {
  return providers.filter((provider) => provider.daily.some((entry) => (entry.totalTokens > 0 || entry.cost > 0))).length;
}

export function renderOneliner(output: TokenleakOutput, options: RenderOptions): string {
  void options;
  const streak = output.aggregated.currentStreak;
  const tokens = formatTokenCount(output.aggregated.totalTokens);
  const cost = formatCostWithCompleteness(output.aggregated.totalCost, output.aggregated.costCompleteness);
  const providerCount = countActiveProviders(output.providers);

  if (providerCount === 0) {
    return `no activity | ${tokens} tokens | ${cost}`;
  }

  return `${streak}d streak | ${tokens} tokens | ${cost} | ${providerCount} active`;
}
