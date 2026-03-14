import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import { buildDashboardModel } from './dashboard-model';
import { formatTokens, formatCost } from './dashboard';

export function renderOneliner(output: TokenleakOutput, options: RenderOptions): string {
  const model = buildDashboardModel(output, options);
  const streak = output.aggregated.currentStreak;
  const tokens = formatTokens(output.aggregated.totalTokens);
  const cost = formatCost(output.aggregated.totalCost);
  const providerCount = model.activeProviders.length;

  if (providerCount === 0) {
    return `no activity | ${tokens} tokens | ${cost}`;
  }

  return `${streak}d streak | ${tokens} tokens | ${cost} | ${providerCount} active`;
}
