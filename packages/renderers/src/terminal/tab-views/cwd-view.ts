import type { TokenleakOutput } from '@tokenleak/core';
import { colorize256, bold, dim, PROJECT_COLORS } from '../colors';
import { truncateVisible } from '../layout';

const BAR_CHAR = '\u2588';
const TRACK_CHAR = '\u2591';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function renderCwdView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const breakdown = output.more?.sessionMetrics?.projectBreakdown;
  if (!breakdown || breakdown.length === 0) {
    return `  ${dim('No event-level data available for project breakdown.', noColor)}`;
  }

  const lines: string[] = [bold('  Projects', noColor), ''];

  const maxTokens = Math.max(...breakdown.map((p) => p.tokens), 0);
  const totalTokens = breakdown.reduce((sum, p) => sum + p.tokens, 0);
  if (maxTokens <= 0) {
    return `  ${dim('No project activity in the selected range.', noColor)}`;
  }

  const nameWidth = Math.min(30, Math.max(12, Math.floor(width * 0.3)));
  const valueWidth = 8;
  const shareWidth = 6;
  const barWidth = Math.max(8, width - nameWidth - valueWidth - shareWidth - 8);

  for (let i = 0; i < breakdown.length; i++) {
    const project = breakdown[i]!;
    const colorCode = PROJECT_COLORS[i % PROJECT_COLORS.length]!;
    const ratio = maxTokens > 0 ? project.tokens / maxTokens : 0;
    const share = totalTokens > 0 ? project.tokens / totalTokens : 0;
    const fillLen = Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * barWidth));
    const bar = colorize256(BAR_CHAR.repeat(fillLen), colorCode, noColor) +
      dim(TRACK_CHAR.repeat(Math.max(0, barWidth - fillLen)), noColor);
    const shareStr = `${(share * 100).toFixed(0)}%`.padStart(shareWidth);
    const tokStr = formatTokens(project.tokens).padStart(valueWidth);
    const name = project.name.length > nameWidth
      ? project.name.slice(0, nameWidth - 1) + '…'
      : project.name.padEnd(nameWidth);

    lines.push(truncateVisible(
      `  ${colorize256(name, colorCode, noColor)} ${bar} ${shareStr} ${tokStr}`,
      width,
    ));
  }

  lines.push('');
  lines.push(`  ${dim(`${breakdown.length} project${breakdown.length === 1 ? '' : 's'} shown (top 10 by tokens)`, noColor)}`);

  return lines.join('\n');
}
