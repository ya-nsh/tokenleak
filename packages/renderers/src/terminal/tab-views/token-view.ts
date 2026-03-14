import type { TokenleakOutput } from '@tokenleak/core';
import { bold, bold256, dim, colorize256 } from '../colors';
import { renderTerminalHeatmap } from '../heatmap';
import { truncateVisible } from '../layout';

const BAR_CHAR = '\u2588';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function renderTokenView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const stats = output.aggregated;
  const lines: string[] = [bold('  Tokens', noColor), ''];

  // Summary
  const parts = [
    bold256(formatTokens(stats.totalTokens), 33, noColor) + ' total',
    bold256(formatCost(stats.totalCost), 40, noColor) + ' cost',
    bold256(`${stats.activeDays}`, 208, noColor) + ' active days',
  ];
  lines.push(truncateVisible(`  ${parts.join(dim('  ·  ', noColor))}`, width));
  lines.push('');

  // Heatmap
  lines.push(`  ${bold('Heatmap', noColor)}`);
  const merged = output.providers.flatMap((p) => p.daily);
  lines.push(renderTerminalHeatmap(merged, { width: width - 2, noColor }));
  lines.push('');

  // Input/output ratio
  const io = output.more?.inputOutput;
  if (io) {
    lines.push(`  ${bold('Input / Output', noColor)}`);
    const inputShare = 1 - io.outputShare;
    const barWidth = Math.max(10, width - 20);
    const inputLen = Math.round(inputShare * barWidth);
    const outputLen = barWidth - inputLen;
    const bar =
      colorize256(BAR_CHAR.repeat(inputLen), 33, noColor) +
      colorize256(BAR_CHAR.repeat(outputLen), 40, noColor);
    lines.push(truncateVisible(
      `  ${bar}  ${dim(`in ${(inputShare * 100).toFixed(0)}%`, noColor)} ${dim(`out ${(io.outputShare * 100).toFixed(0)}%`, noColor)}`,
      width,
    ));
    lines.push('');
  }

  // Cache economics
  const cache = output.more?.cacheEconomics;
  if (cache) {
    lines.push(`  ${bold('Cache Economics', noColor)}`);
    const labelWidth = 20;
    const addLine = (label: string, value: string): void => {
      lines.push(truncateVisible(`  ${dim(label.padEnd(labelWidth), noColor)} ${bold(value, noColor)}`, width));
    };
    addLine('Read tokens', formatTokens(cache.readTokens));
    addLine('Write tokens', formatTokens(cache.writeTokens));
    addLine('Read coverage', `${(cache.readCoverage * 100).toFixed(1)}%`);
    if (cache.reuseRatio !== null) {
      addLine('Reuse ratio', `${cache.reuseRatio.toFixed(1)}x`);
    }
    lines.push('');
  }

  // Monthly burn
  const burn = output.more?.monthlyBurn;
  if (burn) {
    lines.push(`  ${bold('Monthly Burn Projection', noColor)}`);
    const labelWidth = 20;
    lines.push(truncateVisible(
      `  ${dim('Projected tokens'.padEnd(labelWidth), noColor)} ${bold(formatTokens(burn.projectedTokens), noColor)}`,
      width,
    ));
    lines.push(truncateVisible(
      `  ${dim('Projected cost'.padEnd(labelWidth), noColor)} ${bold(formatCost(burn.projectedCost), noColor)}`,
      width,
    ));
    lines.push(truncateVisible(
      `  ${dim('Observed days'.padEnd(labelWidth), noColor)} ${bold(`${burn.observedDays} / ${burn.calendarDays}`, noColor)}`,
      width,
    ));
  }

  return lines.join('\n');
}
