import { aggregate } from '@tokenleak/core';
import type { TokenleakOutput } from '@tokenleak/core';
import { bold, colorize256, dim, PROJECT_COLORS } from '../colors';
import { truncateVisible } from '../layout';

const BAR_CHAR = '\u2588';
const TRACK_CHAR = '\u2591';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function getLastActiveDate(output: TokenleakOutput, providerName: string): string | null {
  const provider = output.providers.find((entry) => entry.provider === providerName);
  const activeDays = provider?.daily.filter((entry) => entry.totalTokens > 0) ?? [];
  return activeDays.at(-1)?.date ?? null;
}

export function renderProviderView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const rows = output.providers
    .map((provider) => {
      const stats = aggregate(provider.daily, output.dateRange.until);
      return {
        provider,
        stats,
        lastActiveDate: getLastActiveDate(output, provider.provider),
      };
    })
    .filter((entry) => entry.stats.totalTokens > 0)
    .sort((left, right) => right.stats.totalTokens - left.stats.totalTokens);

  if (rows.length === 0) {
    return `  ${dim('No provider activity in the selected range.', noColor)}`;
  }

  const lines: string[] = [bold('  Providers', noColor), ''];
  const maxTokens = Math.max(...rows.map((entry) => entry.stats.totalTokens), 0);
  const totalTokens = rows.reduce((sum, entry) => sum + entry.stats.totalTokens, 0);
  const nameWidth = Math.min(18, Math.max(10, Math.floor(width * 0.2)));
  const shareWidth = 6;
  const valueWidth = 8;
  const costWidth = 10;
  const dateWidth = 10;
  const barWidth = Math.max(8, width - nameWidth - shareWidth - valueWidth - costWidth - dateWidth - 12);

  for (let index = 0; index < rows.length; index += 1) {
    const entry = rows[index]!;
    const colorCode = PROJECT_COLORS[index % PROJECT_COLORS.length] ?? 33;
    const ratio = maxTokens > 0 ? entry.stats.totalTokens / maxTokens : 0;
    const share = totalTokens > 0 ? entry.stats.totalTokens / totalTokens : 0;
    const fillLen = Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * barWidth));
    const bar = colorize256(BAR_CHAR.repeat(fillLen), colorCode, noColor) +
      dim(TRACK_CHAR.repeat(Math.max(0, barWidth - fillLen)), noColor);
    const shareStr = `${(share * 100).toFixed(0)}%`.padStart(shareWidth);
    const tokenStr = formatTokens(entry.stats.totalTokens).padStart(valueWidth);
    const costStr = formatCost(entry.stats.totalCost).padStart(costWidth);
    const dateStr = (entry.lastActiveDate ?? '-').padStart(dateWidth);
    const name = entry.provider.displayName.length > nameWidth
      ? `${entry.provider.displayName.slice(0, nameWidth - 1)}…`
      : entry.provider.displayName.padEnd(nameWidth);

    lines.push(truncateVisible(
      `  ${colorize256(name, colorCode, noColor)} ${bar} ${shareStr} ${tokenStr} ${costStr} ${dateStr}`,
      width,
    ));
  }

  lines.push('');
  lines.push(truncateVisible(`  ${dim('Columns: share, tokens, cost, last active', noColor)}`, width));

  return lines.join('\n');
}
