import type { TokenleakOutput, HourOfDayEntry } from '@tokenleak/core';
import { colorize256, bold, dim, TOD_COLORS } from '../colors';
import { truncateVisible } from '../layout';

const BAR_CHAR = '\u2588';
const TRACK_CHAR = '\u2591';

interface TimeBucket {
  label: string;
  hours: string;
  tokens: number;
  cost: number;
  count: number;
}

const BUCKET_RANGES: { label: string; hours: string; start: number; end: number }[] = [
  { label: 'After midnight', hours: '0-5', start: 0, end: 5 },
  { label: 'Morning', hours: '6-11', start: 6, end: 11 },
  { label: 'Afternoon', hours: '12-16', start: 12, end: 16 },
  { label: 'Evening', hours: '17-21', start: 17, end: 21 },
  { label: 'Night', hours: '22-23', start: 22, end: 23 },
];

function groupIntoBuckets(hourOfDay: HourOfDayEntry[]): TimeBucket[] {
  return BUCKET_RANGES.map(({ label, hours, start, end }) => {
    let tokens = 0;
    let cost = 0;
    let count = 0;
    for (let h = start; h <= end; h++) {
      const entry = hourOfDay[h];
      if (entry) {
        tokens += entry.tokens;
        cost += entry.cost;
        count += entry.count;
      }
    }
    return { label, hours, tokens, cost, count };
  });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function renderTodView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const hourOfDay = output.more?.hourOfDay;
  if (!hourOfDay || hourOfDay.length === 0) {
    return `  ${dim('No event-level data available for time-of-day analysis.', noColor)}`;
  }

  const buckets = groupIntoBuckets(hourOfDay);
  const maxTokens = Math.max(...buckets.map((b) => b.tokens), 0);
  const totalTokens = buckets.reduce((sum, b) => sum + b.tokens, 0);

  if (maxTokens <= 0) {
    return `  ${dim('No activity in the selected range.', noColor)}`;
  }

  const lines: string[] = [bold('  Time of Day (UTC)', noColor), ''];

  const labelWidth = 16;
  const valueWidth = 8;
  const costWidth = 10;
  const shareWidth = 6;
  const barWidth = Math.max(8, width - labelWidth - valueWidth - costWidth - shareWidth - 10);

  for (const bucket of buckets) {
    const colorCode = TOD_COLORS[bucket.label] ?? 33;
    const share = totalTokens > 0 ? bucket.tokens / totalTokens : 0;
    const ratio = maxTokens > 0 ? bucket.tokens / maxTokens : 0;
    const fillLen = Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * barWidth));
    const bar = colorize256(BAR_CHAR.repeat(fillLen), colorCode, noColor) +
      dim(TRACK_CHAR.repeat(Math.max(0, barWidth - fillLen)), noColor);
    const shareStr = `${(share * 100).toFixed(0)}%`.padStart(shareWidth);
    const tokStr = formatTokens(bucket.tokens).padStart(valueWidth);
    const costStr = formatCost(bucket.cost).padStart(costWidth);

    lines.push(truncateVisible(
      `  ${colorize256(bucket.label.padEnd(labelWidth), colorCode, noColor)} ${bar} ${shareStr} ${tokStr} ${costStr}`,
      width,
    ));
  }

  lines.push('');
  lines.push(`  ${dim(`Hours shown in UTC. ${buckets.reduce((s, b) => s + b.count, 0)} events total.`, noColor)}`);

  return lines.join('\n');
}
