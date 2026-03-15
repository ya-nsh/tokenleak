import type { TokenleakOutput } from '@tokenleak/core';
import { colorize256, bold, dim, PROJECT_COLORS } from '../colors';
import { truncateVisible } from '../layout';

const BAR_CHAR = '\u2588';
const TRACK_CHAR = '\u2591';
interface AttributionClusterView {
  clusterId: string;
  label: string;
  taskStyle: string;
  repoRoot: string | null;
  directory: string | null;
  sessionCount: number;
  activeDays: number;
  tokens: number;
  cost: number;
  providers: string[];
  models: string[];
  timeWindows: Array<{
    start: string;
    end: string;
    sessionCount: number;
  }>;
}

type CwdMore = NonNullable<TokenleakOutput['more']> & {
  attribution?: AttributionClusterView[] | null;
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatClusterMeta(
  cluster: AttributionClusterView,
): string {
  const parts = [
    cluster.taskStyle.replace(/-/g, ' '),
    `${cluster.sessionCount} sess`,
    `${cluster.activeDays} day${cluster.activeDays === 1 ? '' : 's'}`,
  ];

  if (cluster.providers.length > 0) {
    parts.push(cluster.providers.join(', '));
  }

  if (cluster.models[0]) {
    parts.push(cluster.models[0]);
  }

  return parts.join(' · ');
}

function getAttribution(output: TokenleakOutput): AttributionClusterView[] | null {
  return (output.more as CwdMore | null | undefined)?.attribution ?? null;
}

function renderAttributionView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const attribution = getAttribution(output);
  if (!attribution || attribution.length === 0) {
    return `  ${dim('No event-level data available for attribution.', noColor)}`;
  }

  const lines: string[] = [bold('  Attribution', noColor), ''];
  const maxTokens = Math.max(...attribution.map((entry: AttributionClusterView) => entry.tokens), 0);
  const totalTokens = attribution.reduce(
    (sum: number, entry: AttributionClusterView) => sum + entry.tokens,
    0,
  );

  if (maxTokens <= 0) {
    return `  ${dim('No attributable activity in the selected range.', noColor)}`;
  }

  const nameWidth = Math.min(28, Math.max(12, Math.floor(width * 0.28)));
  const valueWidth = 8;
  const shareWidth = 6;
  const barWidth = Math.max(8, width - nameWidth - valueWidth - shareWidth - 8);

  for (let i = 0; i < Math.min(attribution.length, 8); i++) {
    const cluster = attribution[i]!;
    const colorCode = PROJECT_COLORS[i % PROJECT_COLORS.length]!;
    const ratio = cluster.tokens / maxTokens;
    const share = totalTokens > 0 ? cluster.tokens / totalTokens : 0;
    const fillLen = Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * barWidth));
    const bar = colorize256(BAR_CHAR.repeat(fillLen), colorCode, noColor) +
      dim(TRACK_CHAR.repeat(Math.max(0, barWidth - fillLen)), noColor);
    const shareStr = `${(share * 100).toFixed(0)}%`.padStart(shareWidth);
    const tokStr = formatTokens(cluster.tokens).padStart(valueWidth);
    const name = cluster.label.length > nameWidth
      ? cluster.label.slice(0, nameWidth - 1) + '…'
      : cluster.label.padEnd(nameWidth);

    lines.push(truncateVisible(
      `  ${colorize256(name, colorCode, noColor)} ${bar} ${shareStr} ${tokStr}`,
      width,
    ));

    const meta = formatClusterMeta(cluster);
    const root = cluster.directory && cluster.repoRoot
      ? `${cluster.repoRoot}/${cluster.directory}`
      : cluster.repoRoot ?? cluster.directory;
    const window = cluster.timeWindows[0]
      ? `${cluster.timeWindows[0].start.slice(0, 16)} -> ${cluster.timeWindows.at(-1)?.end.slice(0, 16)}`
      : null;
    const detailParts = [meta];
    if (root) {
      detailParts.push(root);
    }
    if (window) {
      detailParts.push(window);
    }
    lines.push(truncateVisible(`    ${dim(detailParts.join('  |  '), noColor)}`, width));
  }

  lines.push('');
  lines.push(`  ${dim(`${Math.min(attribution.length, 8)} cluster${attribution.length === 1 ? '' : 's'} shown`, noColor)}`);

  return lines.join('\n');
}

function renderProjectBreakdown(output: TokenleakOutput, width: number, noColor: boolean): string {
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

export function renderCwdView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const attribution = getAttribution(output);
  if (attribution && attribution.length > 0) {
    return renderAttributionView(output, width, noColor);
  }

  return renderProjectBreakdown(output, width, noColor);
}
