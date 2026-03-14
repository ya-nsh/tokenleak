import type { TokenleakOutput } from '@tokenleak/core';
import { bold, bold256, dim, colorize256 } from '../colors';
import { truncateVisible } from '../layout';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function renderSessionView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const metrics = output.more?.sessionMetrics;
  if (!metrics || metrics.totalSessions === 0) {
    return `  ${dim('No event-level data available for session analysis.', noColor)}`;
  }

  const lines: string[] = [bold('  Sessions', noColor), ''];

  // Summary line
  const parts: string[] = [
    bold256(`${metrics.totalSessions}`, 33, noColor) + ' sessions',
    bold256(formatCost(metrics.averageCost), 40, noColor) + ' avg/session',
    bold256(formatTokens(metrics.averageTokens), 208, noColor) + ' avg tokens/session',
  ];
  lines.push(truncateVisible(`  ${parts.join(dim('  ·  ', noColor))}`, width));
  lines.push('');

  // Metrics table
  const labelWidth = 24;
  const addMetric = (label: string, value: string): void => {
    lines.push(truncateVisible(`  ${dim(label.padEnd(labelWidth), noColor)} ${bold(value, noColor)}`, width));
  };

  addMetric('Total sessions', String(metrics.totalSessions));
  addMetric('Avg tokens/session', formatTokens(metrics.averageTokens));
  addMetric('Avg cost/session', formatCost(metrics.averageCost));
  addMetric('Avg messages/session', metrics.averageMessages.toFixed(1));

  if (metrics.averageDurationMs !== null) {
    addMetric('Avg duration', formatDuration(metrics.averageDurationMs));
  }

  addMetric('Projects', String(metrics.projectCount));

  if (metrics.longestSession) {
    lines.push('');
    lines.push(`  ${bold('Longest Session', noColor)}`);
    addMetric('  Label', metrics.longestSession.label);
    addMetric('  Tokens', formatTokens(metrics.longestSession.tokens));
    addMetric('  Cost', formatCost(metrics.longestSession.cost));
    addMetric('  Messages', String(metrics.longestSession.count));
    if (metrics.longestSession.durationMs !== null) {
      addMetric('  Duration', formatDuration(metrics.longestSession.durationMs));
    }
  }

  if (metrics.topProject) {
    lines.push('');
    lines.push(truncateVisible(
      `  ${dim('Top project:', noColor)} ${bold256(metrics.topProject.name, 40, noColor)} (${formatTokens(metrics.topProject.tokens)})`,
      width,
    ));
  }

  return lines.join('\n');
}
