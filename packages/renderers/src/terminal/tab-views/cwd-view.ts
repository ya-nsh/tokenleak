import type { TokenleakOutput } from '@tokenleak/core';
import { bold, colorize256, dim, PROJECT_COLORS } from '../colors';
import { truncateVisible } from '../layout';
import { renderCacheRoiBreakdowns } from './cache-roi';

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

function clampLabel(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(1, width - 1))}…` : value.padEnd(width);
}

export function renderCwdView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const projectDrilldown = output.more?.projectDrilldown ?? [];
  const breakdown = output.more?.sessionMetrics?.projectBreakdown;
  if (projectDrilldown.length === 0 && (!breakdown || breakdown.length === 0)) {
    return `  ${dim('No event-level data available for project breakdown.', noColor)}`;
  }

  const lines: string[] = [bold('  Projects', noColor), ''];
  const rankedProjects = projectDrilldown.length > 0
    ? projectDrilldown.slice(0, 5)
    : breakdown!.map((project) => ({
        projectId: project.name,
        sessionCount: 0,
        activeDays: 0,
        streak: 0,
        totalTokens: project.tokens,
        cost: 0,
        directory: null,
        topModels: [],
      }));

  const maxTokens = Math.max(...rankedProjects.map((project) => project.totalTokens), 0);
  const totalTokens = rankedProjects.reduce((sum, project) => sum + project.totalTokens, 0);
  if (maxTokens <= 0) {
    return `  ${dim('No project activity in the selected range.', noColor)}`;
  }

  const nameWidth = Math.min(26, Math.max(12, Math.floor(width * 0.26)));
  const shareWidth = 6;
  const valueWidth = 7;
  const costWidth = 7;
  const barWidth = Math.max(8, width - nameWidth - valueWidth - costWidth - shareWidth - 10);

  if (projectDrilldown.length > 0) {
    const sessionTotal = projectDrilldown.reduce((sum, project) => sum + project.sessionCount, 0);
    lines.push(truncateVisible(
      `  ${dim(`${projectDrilldown.length} projects  ·  ${sessionTotal} sessions ranked by total tokens`, noColor)}`,
      width,
    ));
    lines.push('');
  }

  for (let index = 0; index < rankedProjects.length; index += 1) {
    const project = rankedProjects[index]!;
    const colorCode = PROJECT_COLORS[index % PROJECT_COLORS.length]!;
    const ratio = maxTokens > 0 ? project.totalTokens / maxTokens : 0;
    const share = totalTokens > 0 ? project.totalTokens / totalTokens : 0;
    const fillLen = Math.max(ratio > 0 ? 1 : 0, Math.round(ratio * barWidth));
    const bar = colorize256(BAR_CHAR.repeat(fillLen), colorCode, noColor) +
      dim(TRACK_CHAR.repeat(Math.max(0, barWidth - fillLen)), noColor);

    lines.push(truncateVisible(
      `  ${colorize256(clampLabel(project.projectId, nameWidth), colorCode, noColor)} ${bar} ${`${(share * 100).toFixed(0)}%`.padStart(shareWidth)} ${formatTokens(project.totalTokens).padStart(valueWidth)} ${formatCost(project.cost).padStart(costWidth)}`,
      width,
    ));

    if (projectDrilldown.length > 0) {
      const detailParts = [
        `${project.sessionCount} sess`,
        `${project.activeDays} active day${project.activeDays === 1 ? '' : 's'}`,
        `${project.streak}d streak`,
        project.topModels.length > 0
          ? `models ${project.topModels.slice(0, 2).map((model) => model.model).join(', ')}`
          : null,
        project.directory && project.directory !== project.projectId ? `dir ${project.directory}` : null,
      ].filter((value): value is string => Boolean(value));

      lines.push(truncateVisible(`     ${dim(detailParts.join('  ·  '), noColor)}`, width));
    }
  }

  lines.push('');
  lines.push(`  ${dim(`${rankedProjects.length} project${rankedProjects.length === 1 ? '' : 's'} shown`, noColor)}`);

  const roiLines = renderCacheRoiBreakdowns(
    'Cache ROI by Project',
    output.more?.cacheRoi?.byProject ?? [],
    width,
    noColor,
  );
  if (roiLines.length > 0) {
    lines.push('', ...roiLines);
  }

  return lines.join('\n');
}
