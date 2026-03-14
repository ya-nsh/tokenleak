import type { ProviderData, TokenleakOutput, RenderOptions } from '@tokenleak/core';
import { formatTokens, formatCost } from './dashboard';

function countActiveProviders(providers: ProviderData[]): number {
  return providers.filter((provider) => provider.daily.some((entry) => entry.totalTokens > 0)).length;
}

export function renderOneliner(output: TokenleakOutput, options: RenderOptions): string {
  void options;
  const streak = output.aggregated.currentStreak;
  const tokens = formatTokens(output.aggregated.totalTokens);
  const cost = formatCost(output.aggregated.totalCost);
  const providerCount = countActiveProviders(output.providers);

  if (providerCount === 0) {
    return `no activity | ${tokens} tokens | ${cost}`;
  }

  return `${streak}d streak | ${tokens} tokens | ${cost} | ${providerCount} active`;
}
