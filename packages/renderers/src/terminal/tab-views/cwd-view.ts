import type { TokenleakOutput } from '@tokenleak/core';
import { bold, colorize256, dim, PROJECT_COLORS } from '../colors';
import { truncateVisible } from '../layout';
import { renderCacheRoiBreakdowns } from './cache-roi';
import {
  formatDrilldownFilterSummary,
  getFilteredProjects,
  hasActiveDrilldownFilters,
} from './searchable-drilldown';
import type { DrilldownFilterState } from './searchable-drilldown';

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

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function clampLabel(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(1, width - 1))}…` : value.padEnd(width);
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

function renderProjectBreakdown(
  output: TokenleakOutput,
  width: number,
  noColor: boolean,
  filterState?: DrilldownFilterState | null,
): string {
  const projectDrilldown = output.more?.projectDrilldown ?? [];
  const breakdown = output.more?.sessionMetrics?.projectBreakdown;
  if (projectDrilldown.length === 0 && (!breakdown || breakdown.length === 0)) {
    return `  ${dim('No event-level data available for project breakdown.', noColor)}`;
  }

  const lines: string[] = [bold('  Projects', noColor), ''];
  const summary = formatDrilldownFilterSummary(filterState);
  if (summary) {
    lines.push(truncateVisible(`  ${dim(summary, noColor)}`, width));
    lines.push('');
  }

  const filteredProjects = getFilteredProjects(output, filterState);
  const rankedProjects = projectDrilldown.length > 0
    ? filteredProjects.filtered
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
    const sessionTotal = rankedProjects.reduce((sum, project) => sum + project.sessionCount, 0);
    lines.push(truncateVisible(
      `  ${dim(`${rankedProjects.length} of ${filteredProjects.total} projects shown  ·  ${sessionTotal} sessions matched`, noColor)}`,
      width,
    ));
    lines.push('');
  }

  if (rankedProjects.length === 0) {
    lines.push(`  ${dim('No projects matched the active filters.', noColor)}`);
    return lines.join('\n');
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
    (output.more?.cacheRoi?.byProject ?? []).filter((entry) =>
      rankedProjects.some((project) => project.projectId === entry.label),
    ),
    width,
    noColor,
  );
  if (roiLines.length > 0) {
    lines.push('', ...roiLines);
  }

  return lines.join('\n');
}

export function renderCwdView(
  output: TokenleakOutput,
  width: number,
  noColor: boolean,
  filterState?: DrilldownFilterState | null,
): string {
  const attribution = getAttribution(output);
  const projectView = renderProjectBreakdown(output, width, noColor, filterState);
  if (attribution && attribution.length > 0 && !hasActiveDrilldownFilters(filterState)) {
    return `${renderAttributionView(output, width, noColor)}\n\n${projectView}`;
  }

  return projectView;
}
