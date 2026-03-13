import type { DailyUsage } from '@tokenleak/core';
import { colorize, intensityColor, HEATMAP_BLOCKS } from './ansi';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAY_LABEL_WIDTH = 4;
const WEEK_COLUMN_WIDTH = 2;
const LEGEND_TEXT = 'Less';
const LEGEND_TEXT_MORE = 'More';

interface HeatmapOptions {
  width: number;
  noColor: boolean;
}

function buildUsageMap(daily: DailyUsage[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of daily) {
    map.set(entry.date, (map.get(entry.date) ?? 0) + entry.totalTokens);
  }
  return map;
}

function computeQuantiles(values: number[]): number[] {
  const nonZero = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [0, 0, 0];

  const quantile = (ratio: number): number => {
    const index = Math.floor(ratio * (nonZero.length - 1));
    return nonZero[index] ?? 0;
  };

  return [quantile(0.25), quantile(0.5), quantile(0.75)];
}

function getHeatmapBlock(tokens: number, quantiles: number[]): string {
  if (tokens <= 0) return HEATMAP_BLOCKS.EMPTY;
  if (tokens <= quantiles[0]) return HEATMAP_BLOCKS.LIGHT;
  if (tokens <= quantiles[1]) return HEATMAP_BLOCKS.MEDIUM;
  if (tokens <= quantiles[2]) return HEATMAP_BLOCKS.DARK;
  return HEATMAP_BLOCKS.FULL;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildMonthHeader(weeks: Date[][]): string {
  const header = Array.from({ length: weeks.length * WEEK_COLUMN_WIDTH }, () => ' ');
  let lastMonth = -1;
  let nextFreeIndex = 0;

  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex++) {
    const firstDay = weeks[weekIndex]?.[0];
    if (!firstDay) continue;

    const month = firstDay.getUTCMonth();
    if (month === lastMonth) continue;
    lastMonth = month;

    const desiredStart = weekIndex * WEEK_COLUMN_WIDTH;
    const startIndex = Math.max(desiredStart, nextFreeIndex);
    const remaining = header.length - startIndex;
    if (remaining <= 0) continue;

    const fullLabel = MONTH_LABELS[month] ?? '';
    const label = remaining >= fullLabel.length
      ? fullLabel
      : remaining >= 2
        ? fullLabel.slice(0, 2)
        : fullLabel.slice(0, 1);

    for (let offset = 0; offset < label.length; offset++) {
      header[startIndex + offset] = label[offset] ?? ' ';
    }

    nextFreeIndex = startIndex + label.length + 1;
  }

  return `${' '.repeat(DAY_LABEL_WIDTH)}${header.join('')}`;
}

function buildWeeks(startDate: Date, endDate: Date): Date[][] {
  const alignedStart = new Date(startDate);
  alignedStart.setUTCDate(alignedStart.getUTCDate() - alignedStart.getUTCDay());

  const weeks: Date[][] = [];
  const cursor = new Date(alignedStart);

  while (cursor <= endDate) {
    const week: Date[] = [];
    for (let day = 0; day < 7; day++) {
      week.push(new Date(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }

  return weeks;
}

export function renderTerminalHeatmap(
  daily: DailyUsage[],
  options: HeatmapOptions,
): string {
  if (daily.length === 0) {
    return '  No usage data available.';
  }

  const usageMap = buildUsageMap(daily);
  const quantiles = computeQuantiles(Array.from(usageMap.values()));
  const maxTokens = Math.max(...usageMap.values(), 0);

  const dates = daily.map((entry) => entry.date).sort();
  const startDate = new Date(`${dates[0]}T00:00:00Z`);
  const endDate = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  const weeks = buildWeeks(startDate, endDate);

  const availableColumns = Math.max(WEEK_COLUMN_WIDTH, options.width - DAY_LABEL_WIDTH);
  const maxWeeks = Math.max(1, Math.floor(availableColumns / WEEK_COLUMN_WIDTH));
  const displayWeeks = weeks.slice(Math.max(0, weeks.length - maxWeeks));

  const lines: string[] = [buildMonthHeader(displayWeeks)];

  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const showLabel = dayIndex === 0 || dayIndex === 1 || dayIndex === 3 || dayIndex === 5;
    const label = showLabel ? DAY_LABELS[dayIndex] ?? '   ' : '   ';
    let line = `${label} `.slice(0, DAY_LABEL_WIDTH);

    for (const week of displayWeeks) {
      const date = week[dayIndex];
      if (!date || date < startDate || date > endDate) {
        line += `${HEATMAP_BLOCKS.EMPTY} `;
        continue;
      }

      const dateString = formatDate(date);
      const tokens = usageMap.get(dateString) ?? 0;
      const block = getHeatmapBlock(tokens, quantiles);
      const color = intensityColor(tokens, maxTokens);
      line += `${colorize(block, color, options.noColor)} `;
    }

    lines.push(line.trimEnd());
  }

  const legend = `${' '.repeat(DAY_LABEL_WIDTH)}${LEGEND_TEXT} ${[
    HEATMAP_BLOCKS.EMPTY,
    HEATMAP_BLOCKS.LIGHT,
    HEATMAP_BLOCKS.MEDIUM,
    HEATMAP_BLOCKS.DARK,
    HEATMAP_BLOCKS.FULL,
  ].join('')} ${LEGEND_TEXT_MORE}`;
  lines.push(legend);

  return lines.join('\n');
}
