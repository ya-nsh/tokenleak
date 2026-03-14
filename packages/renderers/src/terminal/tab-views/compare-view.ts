import type { CompareDeltas, TokenleakOutput } from '@tokenleak/core';
import { bold, colorize256, dim } from '../colors';
import { truncateVisible } from '../layout';

function formatTokens(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function colorDelta(text: string, value: number, noColor: boolean): string {
  if (value > 0) return colorize256(text, 40, noColor);
  if (value < 0) return colorize256(text, 196, noColor);
  return dim(text, noColor);
}

function formatSignedNumber(value: number, formatter: (value: number) => string): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ' ';
  return `${sign}${formatter(Math.abs(value))}`;
}

function formatSignedPercentPoints(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ' ';
  return `${sign}${(Math.abs(value) * 100).toFixed(1)}pp`;
}

function renderDeltaRow(
  label: string,
  current: string,
  previous: string,
  delta: string,
  deltaValue: number,
  width: number,
  noColor: boolean,
): string {
  const labelWidth = 18;
  const currentWidth = 11;
  const previousWidth = 11;
  const deltaWidth = 11;

  return truncateVisible(
    `  ${dim(label.padEnd(labelWidth), noColor)} ${bold(current.padStart(currentWidth), noColor)} ${bold(previous.padStart(previousWidth), noColor)} ${colorDelta(delta.padStart(deltaWidth), deltaValue, noColor)}`,
    width,
  );
}

function renderModelShift(
  label: string,
  currentShare: number,
  previousShare: number,
  deltaShare: number,
  width: number,
  noColor: boolean,
): string {
  const delta = formatSignedPercentPoints(deltaShare);
  const shareSummary = `now ${(currentShare * 100).toFixed(0)}% prev ${(previousShare * 100).toFixed(0)}%`;
  return truncateVisible(
    `  ${colorize256(label, 33, noColor)}  ${colorDelta(delta, deltaShare, noColor)}  ${dim(shareSummary, noColor)}`,
    width,
  );
}

export function renderCompareView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const compare = output.more?.compare;
  if (!compare) {
    return `  ${dim('No compare data available. Run with --compare auto to unlock this tab.', noColor)}`;
  }

  const previousStats = compare.previousStats;
  const deltas: CompareDeltas = compare.deltas;
  const lines: string[] = [bold('  Compare', noColor), ''];

  lines.push(truncateVisible(
    `  ${dim('Current', noColor)} ${output.dateRange.since} → ${output.dateRange.until}`,
    width,
  ));
  lines.push(truncateVisible(
    `  ${dim('Previous', noColor)} ${compare.previousRange.since} → ${compare.previousRange.until}`,
    width,
  ));
  lines.push('');
  lines.push(truncateVisible(`  ${dim('Metric'.padEnd(18), noColor)} ${dim('Current'.padStart(11), noColor)} ${dim('Previous'.padStart(11), noColor)} ${dim('Delta'.padStart(11), noColor)}`, width));
  lines.push(renderDeltaRow('Total Tokens', formatTokens(output.aggregated.totalTokens), formatTokens(previousStats.totalTokens), formatSignedNumber(deltas.tokens, formatTokens), deltas.tokens, width, noColor));
  lines.push(renderDeltaRow('Total Cost', formatCost(output.aggregated.totalCost), formatCost(previousStats.totalCost), formatSignedNumber(deltas.cost, formatCost), deltas.cost, width, noColor));
  lines.push(renderDeltaRow('Active Days', String(output.aggregated.activeDays), String(previousStats.activeDays), formatSignedNumber(deltas.activeDays, (value) => String(Math.round(value))), deltas.activeDays, width, noColor));
  lines.push(renderDeltaRow('Current Streak', `${output.aggregated.currentStreak}d`, `${previousStats.currentStreak}d`, formatSignedNumber(deltas.streak, (value) => `${Math.round(value)}d`), deltas.streak, width, noColor));
  lines.push(renderDeltaRow('Avg Daily Tok', formatTokens(output.aggregated.averageDailyTokens), formatTokens(previousStats.averageDailyTokens), formatSignedNumber(deltas.averageDailyTokens, formatTokens), deltas.averageDailyTokens, width, noColor));
  lines.push(renderDeltaRow('Cache Hit Rate', formatPercent(output.aggregated.cacheHitRate), formatPercent(previousStats.cacheHitRate), formatSignedPercentPoints(deltas.cacheHitRate), deltas.cacheHitRate, width, noColor));

  if (compare.modelMixShift.length > 0) {
    lines.push('');
    lines.push(`  ${bold('Model Mix Shift', noColor)}`);
    for (const entry of compare.modelMixShift) {
      lines.push(renderModelShift(
        entry.model,
        entry.currentShare,
        entry.previousShare,
        entry.deltaShare,
        width,
        noColor,
      ));
    }
  }

  return lines.join('\n');
}
