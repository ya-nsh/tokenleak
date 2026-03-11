import type { AggregatedStats, ProviderData } from '@tokenleak/core';
import type { SvgTheme } from './theme';
import {
  STAT_ROW_HEIGHT,
  FONT_SIZE_BODY,
  FONT_SIZE_SMALL,
  FONT_FAMILY,
} from './layout';
import { text, group, formatNumber } from './utils';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface InsightItem {
  label: string;
  value: string;
}

function buildInsights(
  stats: AggregatedStats,
  providers: ProviderData[],
): InsightItem[] {
  const items: InsightItem[] = [];

  // Peak day
  if (stats.peakDay) {
    items.push({
      label: 'Peak Day',
      value: `${stats.peakDay.date} (${formatNumber(stats.peakDay.tokens)} tokens)`,
    });
  }

  // Most active day of week
  if (stats.dayOfWeek.length > 0) {
    const sorted = [...stats.dayOfWeek].sort((a, b) => b.tokens - a.tokens);
    const top = sorted[0];
    if (top) {
      items.push({
        label: 'Most Active Day',
        value: DAY_NAMES[top.day] ?? top.label,
      });
    }
  }

  // Top model
  if (stats.topModels.length > 0) {
    const top = stats.topModels[0];
    if (top) {
      const pct = top.percentage * 100;
      items.push({
        label: 'Top Model',
        value: `${top.model} (${pct.toFixed(1)}%)`,
      });
    }
  }

  // Provider with most usage
  if (providers.length > 0) {
    const sorted = [...providers].sort((a, b) => b.totalTokens - a.totalTokens);
    const top = sorted[0];
    if (top) {
      items.push({
        label: 'Top Provider',
        value: `${top.displayName} (${formatNumber(top.totalTokens)} tokens)`,
      });
    }
  }

  return items;
}

/** Render an insights panel with fun statistics */
export function renderInsightsPanel(
  stats: AggregatedStats,
  providers: ProviderData[],
  theme: SvgTheme,
): { svg: string; width: number; height: number } {
  const items = buildInsights(stats, providers);
  const width = 360;
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

  const height = Math.max(items.length * STAT_ROW_HEIGHT + STAT_ROW_HEIGHT, STAT_ROW_HEIGHT);

  return { svg: group(children), width, height };
}
