import type { TokenleakOutput } from '@tokenleak/core';
import { bold, bold256, colorize256, dim, PROJECT_COLORS, SEMANTIC } from '../colors';
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

function clampLabel(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(1, width - 1))}…` : value.padEnd(width);
}

export function renderSessionView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const metrics = output.more?.sessionMetrics;
  if (!metrics || metrics.totalSessions === 0) {
    return `  ${dim('No event-level data available for session analysis.', noColor)}`;
  }

  const lines: string[] = [bold('  Sessions', noColor), ''];

  const parts: string[] = [
    bold256(`${metrics.totalSessions}`, SEMANTIC.INPUT, noColor) + ' sessions',
    bold256(formatCost(metrics.averageCost), SEMANTIC.OUTPUT, noColor) + ' avg/session',
    bold256(formatTokens(metrics.averageTokens), SEMANTIC.ACCENT, noColor) + ' avg tokens/session',
  ];
  lines.push(truncateVisible(`  ${parts.join(dim('  ·  ', noColor))}`, width));
  lines.push('');

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

  const drilldown = output.more?.sessionDrilldown ?? [];
  if (drilldown.length > 0) {
    lines.push('');
    lines.push(`  ${bold('Top Sessions', noColor)}`);

    const sessions = drilldown.slice(0, 5);
    const sessionLabelWidth = Math.min(28, Math.max(12, width - 46));
    const providerWidth = Math.min(12, Math.max(8, Math.floor(width * 0.15)));
    const tokenWidth = 7;
    const costWidth = 7;
    const durationWidth = 7;
    const eventWidth = 5;

    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index]!;
      const color = PROJECT_COLORS[index % PROJECT_COLORS.length]!;
      const duration = session.durationMs === null
        ? '-'.padStart(durationWidth)
        : formatDuration(session.durationMs).padStart(durationWidth);
      const eventLabel = `${session.eventCount} ev`.padStart(eventWidth);
      const detailParts = [
        session.provider,
        session.topModels.length > 0
          ? `models ${session.topModels.map((model) => model.model).join(', ')}`
          : null,
        session.projectId && session.projectId !== session.label ? `project ${session.projectId}` : null,
        session.directory && session.directory !== session.label ? `dir ${session.directory}` : null,
      ].filter((value): value is string => Boolean(value));

      lines.push(truncateVisible(
        `  ${dim(`${index + 1}.`, noColor)} ${colorize256(clampLabel(session.label, sessionLabelWidth), color, noColor)} ${clampLabel(session.provider, providerWidth)} ${formatTokens(session.totalTokens).padStart(tokenWidth)} ${formatCost(session.cost).padStart(costWidth)} ${duration} ${eventLabel}`,
        width,
      ));
      lines.push(truncateVisible(`     ${dim(detailParts.join('  ·  '), noColor)}`, width));
    }
  } else if (metrics.longestSession) {
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
      `  ${dim('Top project:', noColor)} ${bold256(metrics.topProject.name, SEMANTIC.OUTPUT, noColor)} (${formatTokens(metrics.topProject.tokens)})`,
      width,
    ));
  }

  return lines.join('\n');
}
