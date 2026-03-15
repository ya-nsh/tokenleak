import type { CacheRoiBreakdown, CacheRoiSummary } from '@tokenleak/core';
import { bold, bold256, colorize256, dim, PROJECT_COLORS, SEMANTIC } from '../colors';
import { truncateVisible } from '../layout';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  return `$${Math.abs(cost).toFixed(4)}`;
}

function formatSignedCost(cost: number): string {
  const sign = cost > 0 ? '+' : cost < 0 ? '-' : '';
  return `${sign}${formatCost(cost)}`;
}

function formatRatio(value: number | null): string {
  return value === null ? '-' : `${value.toFixed(1)}x`;
}

export function renderCacheRoiSummary(
  summary: CacheRoiSummary,
  width: number,
  noColor: boolean,
  title: string = 'Prompt Cache ROI',
): string[] {
  const lines: string[] = [`  ${bold(title, noColor)}`];
  const labelWidth = 20;
  const netColor = summary.netSavings >= 0 ? SEMANTIC.OUTPUT : SEMANTIC.NEGATIVE;

  const addLine = (label: string, value: string, colorCode?: number): void => {
    const renderedValue = colorCode === undefined ? bold(value, noColor) : bold256(value, colorCode, noColor);
    lines.push(truncateVisible(`  ${dim(label.padEnd(labelWidth), noColor)} ${renderedValue}`, width));
  };

  addLine('Read savings', formatCost(summary.readSavings), SEMANTIC.OUTPUT);
  addLine('Write cost', formatCost(summary.writeCost), SEMANTIC.ACCENT);
  addLine('Net savings', formatSignedCost(summary.netSavings), netColor);
  addLine('Payback ratio', formatRatio(summary.paybackRatio));
  addLine('Reuse ratio', formatRatio(summary.reuseRatio));
  addLine('Read / write', `${formatTokens(summary.readTokens)} / ${formatTokens(summary.writeTokens)}`);

  return lines;
}

export function renderCacheRoiBreakdowns(
  title: string,
  breakdowns: CacheRoiBreakdown[],
  width: number,
  noColor: boolean,
  limit: number = 5,
): string[] {
  if (breakdowns.length === 0) {
    return [];
  }

  const rows = breakdowns.slice(0, limit);
  const lines: string[] = [`  ${bold(title, noColor)}`];
  const labelWidth = Math.min(28, Math.max(12, Math.floor(width * 0.32)));

  for (let index = 0; index < rows.length; index += 1) {
    const entry = rows[index]!;
    const colorCode = PROJECT_COLORS[index % PROJECT_COLORS.length] ?? SEMANTIC.ACCENT;
    const name = entry.label.length > labelWidth
      ? `${entry.label.slice(0, labelWidth - 1)}…`
      : entry.label.padEnd(labelWidth);
    const netText = formatSignedCost(entry.netSavings).padStart(10);
    const paybackText = formatRatio(entry.paybackRatio).padStart(6);
    const reuseText = formatRatio(entry.reuseRatio).padStart(6);
    const volumeText = `${formatTokens(entry.readTokens)} / ${formatTokens(entry.writeTokens)}`;
    const netColor = entry.netSavings >= 0 ? SEMANTIC.OUTPUT : SEMANTIC.NEGATIVE;

    lines.push(truncateVisible(
      `  ${colorize256(name, colorCode, noColor)} ${bold256(netText, netColor, noColor)} ${paybackText} ${reuseText} ${volumeText}`,
      width,
    ));
  }

  lines.push(truncateVisible(`  ${dim('Columns: net, payback, reuse, read/write tokens', noColor)}`, width));
  return lines;
}
