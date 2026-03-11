import type { AggregatedStats } from '@tokenleak/core';
import type { SvgTheme } from './theme';
import {
  STAT_ROW_HEIGHT,
  FONT_SIZE_BODY,
  FONT_SIZE_SMALL,
  FONT_FAMILY,
} from './layout';
import { text, group, formatNumber, formatCost, formatPercent } from './utils';

interface StatItem {
  label: string;
  value: string;
}

function buildStatItems(stats: AggregatedStats): StatItem[] {
  return [
    { label: 'Current Streak', value: `${stats.currentStreak} days` },
    { label: 'Longest Streak', value: `${stats.longestStreak} days` },
    { label: 'Total Tokens', value: formatNumber(stats.totalTokens) },
    { label: 'Total Cost', value: formatCost(stats.totalCost) },
    { label: '30-Day Tokens', value: formatNumber(stats.rolling30dTokens) },
    { label: '30-Day Cost', value: formatCost(stats.rolling30dCost) },
    { label: 'Avg Daily Tokens', value: formatNumber(stats.averageDailyTokens) },
    { label: 'Cache Hit Rate', value: formatPercent(stats.cacheHitRate) },
    { label: 'Active Days', value: `${stats.activeDays} / ${stats.totalDays}` },
  ];
}

/** Render a stats panel showing key aggregated statistics */
export function renderStatsPanel(
  stats: AggregatedStats,
  theme: SvgTheme,
): { svg: string; width: number; height: number } {
  const items = buildStatItems(stats);
  const width = 280;
  const children: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const y = i * STAT_ROW_HEIGHT + STAT_ROW_HEIGHT;

    children.push(
      text(0, y, item.label, {
        fill: theme.muted,
        'font-size': FONT_SIZE_SMALL,
        'font-family': FONT_FAMILY,
      }),
    );

    children.push(
      text(width - 8, y, item.value, {
        fill: theme.foreground,
        'font-size': FONT_SIZE_BODY,
        'font-family': FONT_FAMILY,
        'text-anchor': 'end',
      }),
    );
  }

  const height = items.length * STAT_ROW_HEIGHT + STAT_ROW_HEIGHT;

  return { svg: group(children), width, height };
}
