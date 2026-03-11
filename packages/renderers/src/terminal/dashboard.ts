import type { TokenleakOutput, RenderOptions, ProviderData, AggregatedStats } from '@tokenleak/core';
import { colorize } from './ansi';
import { renderTerminalHeatmap } from './heatmap';

const BOX_H = '\u2500'; // ─
const BOX_V = '\u2502'; // │
const BOX_TL = '\u250C'; // ┌
const BOX_TR = '\u2510'; // ┐
const BOX_BL = '\u2514'; // └
const BOX_BR = '\u2518'; // ┘

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const BAR_CHAR = '\u2588'; // █
const MAX_BAR_LENGTH = 20;

/**
 * Formats a token count in a human-readable way (e.g. 150K, 1.2M).
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(0)}K`;
  }
  return String(count);
}

/**
 * Formats a cost value as a dollar string.
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

/**
 * Formats a percentage (0..1) as a display string.
 */
function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Creates a horizontal divider line.
 */
function divider(width: number): string {
  return BOX_H.repeat(width);
}

/**
 * Creates a boxed header line.
 */
function boxedHeader(title: string, width: number, noColor: boolean): string {
  const inner = width - 2; // account for │ on each side
  const padded = ` ${title} `;
  const remaining = Math.max(0, inner - padded.length);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  const content = `${BOX_H.repeat(left)}${padded}${BOX_H.repeat(right)}`;
  const top = `${BOX_TL}${BOX_H.repeat(inner)}${BOX_TR}`;
  const headerLine = `${BOX_V}${colorize(content, 'bold', noColor)}${BOX_V}`;
  const bottom = `${BOX_BL}${BOX_H.repeat(inner)}${BOX_BR}`;
  return [top, headerLine, bottom].join('\n');
}

/**
 * Renders a simple horizontal bar for day-of-week breakdown.
 */
function dayBar(tokens: number, maxTokens: number, noColor: boolean): string {
  if (maxTokens <= 0) return '';
  const length = Math.round((tokens / maxTokens) * MAX_BAR_LENGTH);
  const bar = BAR_CHAR.repeat(length);
  return colorize(bar, 'green', noColor);
}

/**
 * Renders the stats section.
 */
function renderStats(stats: AggregatedStats, width: number, noColor: boolean): string {
  const lines: string[] = [];
  const labelWidth = 20;

  const entries: [string, string][] = [
    ['Current Streak', `${stats.currentStreak}d`],
    ['Longest Streak', `${stats.longestStreak}d`],
    ['Total Tokens', formatTokens(stats.totalTokens)],
    ['Total Cost', formatCost(stats.totalCost)],
    ['30d Tokens', formatTokens(stats.rolling30dTokens)],
    ['30d Cost', formatCost(stats.rolling30dCost)],
    ['7d Tokens', formatTokens(stats.rolling7dTokens)],
    ['7d Cost', formatCost(stats.rolling7dCost)],
    ['Avg Daily Tokens', formatTokens(stats.averageDailyTokens)],
    ['Avg Daily Cost', formatCost(stats.averageDailyCost)],
    ['Cache Hit Rate', formatPercent(stats.cacheHitRate)],
    ['Active Days', `${stats.activeDays} / ${stats.totalDays}`],
  ];

  if (stats.peakDay) {
    entries.push(['Peak Day', `${stats.peakDay.date} (${formatTokens(stats.peakDay.tokens)})`]);
  }

  for (const [label, value] of entries) {
    const line = `  ${label.padEnd(labelWidth)} ${colorize(value, 'cyan', noColor)}`;
    lines.push(line.length > width ? line.slice(0, width) : line);
  }

  return lines.join('\n');
}

/**
 * Renders the day-of-week breakdown.
 */
function renderDayOfWeek(stats: AggregatedStats, width: number, noColor: boolean): string {
  const lines: string[] = [];
  const maxTokens = Math.max(...stats.dayOfWeek.map((d) => d.tokens), 0);

  for (const entry of stats.dayOfWeek) {
    const label = DAY_NAMES[entry.day] ?? `Day${entry.day}`;
    const bar = dayBar(entry.tokens, maxTokens, noColor);
    const tokenStr = formatTokens(entry.tokens);
    const line = `  ${label}  ${bar} ${tokenStr}`;
    lines.push(line.length > width ? line.slice(0, width) : line);
  }

  return lines.join('\n');
}

/**
 * Renders the top models list.
 */
function renderTopModels(stats: AggregatedStats, width: number, noColor: boolean): string {
  const lines: string[] = [];

  for (const model of stats.topModels.slice(0, 5)) {
    const pct = formatPercent(model.percentage);
    const tokens = formatTokens(model.tokens);
    const line = `  ${colorize(model.model, 'yellow', noColor)}  ${tokens}  ${pct}`;
    lines.push(line.length > width ? line.slice(0, width) : line);
  }

  return lines.join('\n');
}

/**
 * Renders insights as bullet points.
 */
function renderInsights(stats: AggregatedStats, noColor: boolean): string {
  const insights: string[] = [];

  if (stats.currentStreak > 7) {
    insights.push(`You have a ${stats.currentStreak}-day coding streak going!`);
  }
  if (stats.cacheHitRate > 0.5) {
    insights.push(`Cache hit rate is ${formatPercent(stats.cacheHitRate)} - good cache reuse.`);
  }
  if (stats.cacheHitRate < 0.1 && stats.totalTokens > 0) {
    insights.push('Cache hit rate is low - consider enabling prompt caching.');
  }
  if (stats.peakDay) {
    insights.push(`Peak usage was on ${stats.peakDay.date} with ${formatTokens(stats.peakDay.tokens)} tokens.`);
  }

  if (insights.length === 0) return '';

  return insights
    .map((i) => `  ${colorize('*', 'green', noColor)} ${i}`)
    .join('\n');
}

/**
 * Renders a single provider section.
 */
function renderProviderSection(
  provider: ProviderData,
  stats: AggregatedStats,
  width: number,
  noColor: boolean,
  showInsights: boolean,
): string {
  const sections: string[] = [];

  // Provider header
  sections.push(boxedHeader(provider.displayName, width, noColor));

  // Heatmap
  sections.push('');
  sections.push(colorize('  Heatmap', 'bold', noColor));
  sections.push(renderTerminalHeatmap(provider.daily, { width, noColor }));

  // Stats
  sections.push('');
  sections.push(colorize('  Stats', 'bold', noColor));
  sections.push(renderStats(stats, width, noColor));

  // Day of week
  if (stats.dayOfWeek.length > 0) {
    sections.push('');
    sections.push(colorize('  Day of Week', 'bold', noColor));
    sections.push(renderDayOfWeek(stats, width, noColor));
  }

  // Top models
  if (stats.topModels.length > 0) {
    sections.push('');
    sections.push(colorize('  Top Models', 'bold', noColor));
    sections.push(renderTopModels(stats, width, noColor));
  }

  // Insights
  if (showInsights) {
    const insightsText = renderInsights(stats, noColor);
    if (insightsText) {
      sections.push('');
      sections.push(colorize('  Insights', 'bold', noColor));
      sections.push(insightsText);
    }
  }

  return sections.join('\n');
}

/**
 * Renders the full terminal dashboard.
 */
export function renderDashboard(output: TokenleakOutput, options: RenderOptions): string {
  const width = options.width;
  const noColor = options.noColor;
  const sections: string[] = [];

  // Title
  sections.push(boxedHeader('Tokenleak', width, noColor));
  sections.push('');

  if (output.providers.length === 0) {
    sections.push('  No provider data available.');
    return sections.join('\n');
  }

  // Render each provider
  for (let i = 0; i < output.providers.length; i++) {
    const provider = output.providers[i]!;
    sections.push(
      renderProviderSection(
        provider,
        output.aggregated,
        width,
        noColor,
        options.showInsights,
      ),
    );

    // Divider between providers
    if (i < output.providers.length - 1) {
      sections.push('');
      sections.push(divider(width));
      sections.push('');
    }
  }

  // Overall summary if multiple providers
  if (output.providers.length > 1) {
    sections.push('');
    sections.push(divider(width));
    sections.push('');
    sections.push(boxedHeader('Overall', width, noColor));
    sections.push('');
    sections.push(renderStats(output.aggregated, width, noColor));
  }

  return sections.join('\n');
}
