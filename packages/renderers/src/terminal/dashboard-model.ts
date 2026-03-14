import { aggregate, mergeProviderData } from '@tokenleak/core';
import type { AggregatedStats, DailyUsage, ProviderData, RenderOptions, TokenleakOutput } from '@tokenleak/core';

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

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(0)}K`;
  }
  return String(count);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatSharePercent(percentage: number): string {
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
  const activeDays = provider.daily.filter((entry) => entry.totalTokens > 0);
  return activeDays.at(-1)?.date ?? null;
}

function buildMetricEntries(stats: AggregatedStats): MetricEntry[] {
  const metrics: MetricEntry[] = [
    { label: 'Current Streak', value: `${stats.currentStreak}d` },
    { label: 'Longest Streak', value: `${stats.longestStreak}d` },
    { label: 'Total Tokens', value: formatTokens(stats.totalTokens) },
    { label: 'Total Cost', value: formatCost(stats.totalCost) },
  ];

  if (stats.rolling30dTokens > 0 || stats.rolling30dCost > 0) {
    metrics.push({ label: '30d Tokens', value: formatTokens(stats.rolling30dTokens) });
    metrics.push({ label: '30d Cost', value: formatCost(stats.rolling30dCost) });
  }

  if (stats.rolling7dTokens > 0 || stats.rolling7dCost > 0) {
    metrics.push({ label: '7d Tokens', value: formatTokens(stats.rolling7dTokens) });
    metrics.push({ label: '7d Cost', value: formatCost(stats.rolling7dCost) });
  }

  if (stats.activeDays > 0) {
    metrics.push({ label: 'Avg Daily Tokens', value: formatTokens(stats.averageDailyTokens) });
    metrics.push({ label: 'Avg Daily Cost', value: formatCost(stats.averageDailyCost) });
  }

  if (stats.totalTokens > 0) {
    metrics.push({ label: 'Cache Hit Rate', value: formatPercent(stats.cacheHitRate) });
  }

  metrics.push({ label: 'Active Days', value: `${stats.activeDays} / ${stats.totalDays}` });

  if (stats.peakDay) {
    metrics.push({
      label: 'Peak Day',
      value: `${stats.peakDay.date} (${formatTokens(stats.peakDay.tokens)})`,
    });
  }

  return metrics;
}

function buildProviderSummary(provider: ProviderData, stats: AggregatedStats): string[] {
  const parts = [
    `${formatTokens(stats.totalTokens)} tokens`,
    formatCost(stats.totalCost),
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
    insights.push(`Peak usage hit ${formatTokens(stats.peakDay.tokens)} on ${stats.peakDay.date}.`);
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
      value: formatTokens(entry.tokens),
      share: entry.tokens / maxTokens,
    }));
}

function buildTopModelPatterns(stats: AggregatedStats): PatternEntry[] {
  return stats.topModels
    .slice(0, 5)
    .filter((entry) => entry.tokens > 0)
    .map((entry) => ({
      label: entry.model,
      value: formatSharePercent(entry.percentage),
      share: Math.max(0.03, entry.percentage / 100),
    }));
}

function buildProviderModel(provider: ProviderData, until: string): ProviderDashboardModel | null {
  const stats = aggregate(provider.daily, until);
  if (stats.totalTokens <= 0) {
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
    `${formatTokens(output.aggregated.totalTokens)} tokens`,
    formatCost(output.aggregated.totalCost),
    `${activeProviders.length} active provider${activeProviders.length === 1 ? '' : 's'}`,
    `${output.aggregated.activeDays} active day${output.aggregated.activeDays === 1 ? '' : 's'}`,
  ];

  const metrics = buildMetricEntries(output.aggregated);
  const maxProviderTokens = Math.max(...activeProviders.map((entry) => entry.stats.totalTokens), 0);
  const providerLeaders = activeProviders
    .slice()
    .sort((left, right) => right.stats.totalTokens - left.stats.totalTokens)
    .map((entry) => ({
      label: entry.provider.displayName,
      value: formatTokens(entry.stats.totalTokens),
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
    const model = buildProviderModel(provider, output.dateRange.until);
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

export { formatCost, formatPercent, formatSharePercent, formatTokens };
