import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import { formatTokens, formatCost } from './dashboard';

/**
 * Renders a single-line summary of the tokenleak output.
 * Uses emoji for quick visual scanning.
 */
export function renderOneliner(output: TokenleakOutput, _options: RenderOptions): string {
  const streak = output.aggregated.currentStreak;
  const tokens = formatTokens(output.aggregated.totalTokens);
  const cost = formatCost(output.aggregated.totalCost);
  const providerCount = output.providers.length;

  return `\uD83D\uDD25 ${streak}d streak | ${tokens} tokens | ${cost} | ${providerCount} provider${providerCount !== 1 ? 's' : ''}`;
}
