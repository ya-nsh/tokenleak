import { aggregate, mergeProviderData, formatCostWithCompleteness, formatModelWithTier, formatTokenCount, formatUsd } from '@tokenleak/core';
import type {
  AggregatedStats,
  CacheRoiSummary,
  DailyUsage,
  ProviderData,
  RenderOptions,
  TokenleakOutput,
} from '@tokenleak/core';

export type DashboardMode = 'full' | 'compact' | 'summary';

export interface MetricEntry {
  label: string;
  value: string;
}

export interface PatternEntry {
  label: string;
  value: string;
  share: number;
}

export interface ProviderDashboardModel {
  provider: ProviderData;
  stats: AggregatedStats;
  summary: string[];
  trend: string;
  metrics: MetricEntry[];
  dayOfWeek: PatternEntry[];
  topModels: PatternEntry[];
  insights: string[];
  lastActiveDate: string | null;
}

export interface DashboardOverviewModel {
  summary: string[];
  trend: string;
  metrics: MetricEntry[];
  providerLeaders: PatternEntry[];
}

export interface DashboardModel {
  mode: DashboardMode;
  rangeLabel: string;
  activeProviders: ProviderDashboardModel[];
  inactiveProviders: string[];
  overview: DashboardOverviewModel;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** Shares never round to a misleading 0% or 100% while other entries exist. */
export function formatSharePercent(percentage: number): string {
  if (percentage <= 0) return '0%';
  if (percentage < 0.5) return '<1%';
  if (percentage < 100 && percentage >= 99.5) return '>99%';
  return `${percentage.toFixed(0)}%`;
}

function buildRangeLabel(output: TokenleakOutput): string {
  return `${output.dateRange.since} -> ${output.dateRange.until}`;
}

function buildSparkline(daily: DailyUsage[], points = 14): string {
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
  if (daily.length === 0) return '·'.repeat(points);

  const values = daily
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-points)
    .map((entry) => entry.totalTokens);
  const max = Math.max(...values, 0);

  if (max <= 0) {
    return '·'.repeat(values.length);
  }

  return values
    .map((value) => {
      const index = Math.min(blocks.length - 1, Math.round((value / max) * (blocks.length - 1)));
      return blocks[index] ?? blocks[0];
    })
    .join('');
}

function getLastActiveDate(provider: ProviderData): string | null {
  const activeDays = provider.daily.filter((entry) => (entry.totalTokens > 0 || entry.cost > 0));
  return activeDays.at(-1)?.date ?? null;
}

function buildMetricEntries(
  stats: AggregatedStats,
  cacheRoiSummary: CacheRoiSummary | null = null,
): MetricEntry[] {
  const metrics: MetricEntry[] = [
    { label: 'Current Streak', value: `${stats.currentStreak}d` },
    { label: 'Longest Streak', value: `${stats.longestStreak}d` },
    { label: 'Total Tokens', value: formatTokenCount(stats.totalTokens) },
    { label: 'Total Cost', value: formatCostWithCompleteness(stats.totalCost, stats.costCompleteness) },
  ];

  if (stats.rolling30dTokens > 0 || stats.rolling30dCost > 0) {
    metrics.push({ label: '30d Tokens', value: formatTokenCount(stats.rolling30dTokens) });
    metrics.push({ label: '30d Cost', value: formatCostWithCompleteness(stats.rolling30dCost, stats.rolling30dCostCompleteness ?? stats.costCompleteness) });
  }

  if (stats.rolling7dTokens > 0 || stats.rolling7dCost > 0) {
    metrics.push({ label: '7d Tokens', value: formatTokenCount(stats.rolling7dTokens) });
    metrics.push({ label: '7d Cost', value: formatCostWithCompleteness(stats.rolling7dCost, stats.rolling7dCostCompleteness ?? stats.costCompleteness) });
  }

  if (stats.activeDays > 0) {
    metrics.push({ label: 'Avg Daily Tokens', value: formatTokenCount(stats.averageDailyTokens) });
    metrics.push({ label: 'Avg Daily Cost', value: formatCostWithCompleteness(stats.averageDailyCost, stats.costCompleteness) });
  }

  if (stats.totalTokens > 0) {
    metrics.push({ label: 'Cache Hit Rate', value: formatPercent(stats.cacheHitRate) });
  }

  metrics.push({ label: 'Active Days', value: `${stats.activeDays} / ${stats.totalDays}` });

  if (stats.peakDay) {
    metrics.push({
      label: 'Peak Day',
      value: `${stats.peakDay.date} (${formatTokenCount(stats.peakDay.tokens)})`,
    });
  }

  if (cacheRoiSummary) {
    metrics.push({
      label: 'Cache ROI',
      value: `${cacheRoiSummary.netSavings >= 0 ? '+' : '-'}${formatUsd(Math.abs(cacheRoiSummary.netSavings))}`,
    });
    if (cacheRoiSummary.paybackRatio !== null) {
      metrics.push({
        label: 'Cache Payback',
        value: `${cacheRoiSummary.paybackRatio.toFixed(1)}x`,
      });
    }
  }

  return metrics;
}

function buildProviderSummary(provider: ProviderData, stats: AggregatedStats): string[] {
  const parts = [
    `${formatTokenCount(stats.totalTokens)} tokens`,
    formatCostWithCompleteness(stats.totalCost, stats.costCompleteness),
    `${stats.activeDays} active day${stats.activeDays === 1 ? '' : 's'}`,
  ];
  const lastActiveDate = getLastActiveDate(provider);
  if (lastActiveDate) {
    parts.push(`last active ${lastActiveDate}`);
  }
  if (stats.topModels[0]) {
    parts.push(`${stats.topModels[0].model} ${formatSharePercent(stats.topModels[0].percentage)}`);
  }
  return parts;
}

function buildInsights(stats: AggregatedStats): string[] {
  const insights: string[] = [];

  if (stats.currentStreak >= 7) {
    insights.push(`${stats.currentStreak}-day streak is still alive.`);
  }
  if (stats.cacheHitRate >= 0.5) {
    insights.push(`Cache reuse is strong at ${formatPercent(stats.cacheHitRate)}.`);
  } else if (stats.cacheHitRate < 0.1 && stats.totalTokens > 0) {
    insights.push('Cache reuse is low. There is room to improve prompt caching.');
  }
  if (stats.peakDay) {
    insights.push(`Peak usage hit ${formatTokenCount(stats.peakDay.tokens)} on ${stats.peakDay.date}.`);
  }
  if (stats.topModels[0] && stats.topModels[0].percentage >= 70) {
    insights.push(`${stats.topModels[0].model} dominates at ${formatSharePercent(stats.topModels[0].percentage)}.`);
  }

  return insights;
}

function buildDayOfWeekPatterns(stats: AggregatedStats): PatternEntry[] {
  const maxTokens = Math.max(...stats.dayOfWeek.map((entry) => entry.tokens), 0);
  if (maxTokens <= 0) {
    return [];
  }

  return stats.dayOfWeek
    .filter((entry) => entry.tokens > 0)
    .map((entry) => ({
      label: entry.label,
      value: formatTokenCount(entry.tokens),
      share: entry.tokens / maxTokens,
    }));
}

function buildTopModelPatterns(stats: AggregatedStats): PatternEntry[] {
  return stats.topModels
    .slice(0, 5)
    .filter((entry) => entry.tokens > 0)
    .map((entry) => ({
      label: formatModelWithTier(entry.model, entry.serviceTiers),
      value: formatSharePercent(entry.percentage),
      share: entry.percentage / 100,
    }));
}

function buildProviderModel(provider: ProviderData, dateRange: TokenleakOutput['dateRange']): ProviderDashboardModel | null {
  const stats = aggregate(provider.daily, dateRange.until, dateRange);
  // Some providers (Crush, Cursor exports) report spend without token counts.
  if (stats.totalTokens <= 0 && stats.totalCost <= 0) {
    return null;
  }

  return {
    provider,
    stats,
    summary: buildProviderSummary(provider, stats),
    trend: buildSparkline(provider.daily),
    metrics: buildMetricEntries(stats),
    dayOfWeek: buildDayOfWeekPatterns(stats),
    topModels: buildTopModelPatterns(stats),
    insights: buildInsights(stats),
    lastActiveDate: getLastActiveDate(provider),
  };
}

function buildOverview(output: TokenleakOutput, activeProviders: ProviderDashboardModel[]): DashboardOverviewModel {
  const mergedDaily = activeProviders.length > 0
    ? mergeProviderData(activeProviders.map((entry) => entry.provider))
    : [];
  const summary = [
    `${formatTokenCount(output.aggregated.totalTokens)} tokens`,
    formatCostWithCompleteness(output.aggregated.totalCost, output.aggregated.costCompleteness),
    `${activeProviders.length} active provider${activeProviders.length === 1 ? '' : 's'}`,
    `${output.aggregated.activeDays} active day${output.aggregated.activeDays === 1 ? '' : 's'}`,
  ];

  const metrics = buildMetricEntries(output.aggregated, output.more?.cacheRoi?.summary ?? null);
  const maxProviderTokens = Math.max(...activeProviders.map((entry) => entry.stats.totalTokens), 0);
  const providerLeaders = activeProviders
    .slice()
    .sort((left, right) => right.stats.totalTokens - left.stats.totalTokens)
    .map((entry) => ({
      label: entry.provider.displayName,
      value: formatTokenCount(entry.stats.totalTokens),
      share: maxProviderTokens > 0 ? entry.stats.totalTokens / maxProviderTokens : 0,
    }));

  return {
    summary,
    trend: buildSparkline(mergedDaily),
    metrics,
    providerLeaders,
  };
}

function resolveDashboardMode(width: number): DashboardMode {
  if (width < 32) return 'summary';
  if (width < 56) return 'compact';
  return 'full';
}

export function buildDashboardModel(
  output: TokenleakOutput,
  options: RenderOptions,
): DashboardModel {
  const activeProviders: ProviderDashboardModel[] = [];
  const inactiveProviders: string[] = [];

  for (const provider of output.providers) {
    const model = buildProviderModel(provider, output.dateRange);
    if (model) {
      activeProviders.push(model);
    } else {
      inactiveProviders.push(provider.displayName);
    }
  }

  return {
    mode: resolveDashboardMode(options.width),
    rangeLabel: buildRangeLabel(output),
    activeProviders,
    inactiveProviders,
    overview: buildOverview(output, activeProviders),
  };
}

