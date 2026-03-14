import type { TokenleakOutput } from '@tokenleak/core';
import { colorize256, bold, dim, DOW_COLORS } from '../colors';
import { truncateVisible, padVisible, visibleLength } from '../layout';

const BAR_CHAR = '\u2588';
const TRACK_CHAR = '\u2591';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return String(count);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function renderDowView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const dow = output.aggregated.dayOfWeek;
  if (dow.length === 0) {
    return `  ${dim('No day-of-week data available.', noColor)}`;
  }

  const maxTokens = Math.max(...dow.map((d) => d.tokens), 0);
  const totalTokens = dow.reduce((sum, d) => sum + d.tokens, 0);
  if (maxTokens <= 0) {
    return `  ${dim('No activity in the selected range.', noColor)}`;
  }

  const lines: string[] = [bold('  Day of Week', noColor), ''];

  const nameWidth = 5;
  const valueWidth = 8;
  const costWidth = 10;
  const shareWidth = 6;
  const barWidth = Math.max(8, width - nameWidth - valueWidth - costWidth - shareWidth - 10);

  for (const entry of dow) {
    const label = DAY_NAMES[entry.day] ?? '???';
    const colorCode = DOW_COLORS[label] ?? 33;
    const share = totalTokens > 0 ? entry.tokens / totalTokens : 0;
    const ratio = maxTokens > 0 ? entry.tokens / maxTokens : 0;
    const fillLen = Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * barWidth));
    const bar = colorize256(BAR_CHAR.repeat(fillLen), colorCode, noColor) +
      dim(TRACK_CHAR.repeat(Math.max(0, barWidth - fillLen)), noColor);
    const shareStr = `${(share * 100).toFixed(0)}%`.padStart(shareWidth);
    const tokStr = formatTokens(entry.tokens).padStart(valueWidth);
    const costStr = formatCost(entry.cost).padStart(costWidth);

    lines.push(truncateVisible(
      `  ${colorize256(label.padEnd(nameWidth), colorCode, noColor)} ${bar} ${shareStr} ${tokStr} ${costStr}`,
      width,
    ));
  }

  return lines.join('\n');
}
