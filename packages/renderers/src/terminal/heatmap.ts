import type { DailyUsage } from '@tokenleak/core';
import { colorize, intensityBlock, intensityColor, HEATMAP_BLOCKS } from './ansi';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAY_LABEL_WIDTH = 4; // "Mon " = 4 chars
const LEGEND_TEXT = 'Less';
const LEGEND_TEXT_MORE = 'More';

interface HeatmapOptions {
  width: number;
  noColor: boolean;
}

/**
 * Builds a date -> totalTokens lookup from daily usage data.
 */
function buildUsageMap(daily: DailyUsage[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of daily) {
    map.set(entry.date, (map.get(entry.date) ?? 0) + entry.totalTokens);
  }
  return map;
}

/**
 * Renders a text-based heatmap of daily usage.
 * Similar to a GitHub contribution graph.
 */
export function renderTerminalHeatmap(
  daily: DailyUsage[],
  options: HeatmapOptions,
): string {
  if (daily.length === 0) {
    return '  No usage data available.';
  }

  const usageMap = buildUsageMap(daily);
  const maxTokens = Math.max(...usageMap.values(), 0);

  // Determine date range
  const dates = daily.map((d) => d.date).sort();
  const startDate = new Date(dates[0]!);
  const endDate = new Date(dates[dates.length - 1]!);

  // Align start to a Sunday
  const alignedStart = new Date(startDate);
  alignedStart.setDate(alignedStart.getDate() - alignedStart.getDay());

  // Collect all weeks
  const weeks: Date[][] = [];
  const current = new Date(alignedStart);
  while (current <= endDate) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }

  // Calculate available width for week columns
  const availableWidth = options.width - DAY_LABEL_WIDTH;
  const maxWeeks = Math.min(weeks.length, availableWidth);
  const displayWeeks = weeks.slice(Math.max(0, weeks.length - maxWeeks));

  const lines: string[] = [];

  // Month labels header
  let monthHeader = ' '.repeat(DAY_LABEL_WIDTH);
  let lastMonth = -1;
  for (const week of displayWeeks) {
    const month = week[0]!.getMonth();
    if (month !== lastMonth) {
      monthHeader += MONTH_LABELS[month];
      lastMonth = month;
      // Skip characters for the label length minus 1 (the current column)
      const labelLen = MONTH_LABELS[month]!.length;
      // We already placed the label; we need to account for it in subsequent columns
      // Simply track that we used extra chars
    } else {
      monthHeader += ' ';
    }
  }
  // Trim to width
  if (monthHeader.length > options.width) {
    monthHeader = monthHeader.slice(0, options.width);
  }
  lines.push(monthHeader);

  // Render each day row (Sun through Sat)
  for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
    const label = dayIdx % 2 === 1 ? DAY_LABELS[dayIdx]! : '   ';
    let line = label + ' ';
    // Ensure label is exactly DAY_LABEL_WIDTH
    line = line.slice(0, DAY_LABEL_WIDTH);

    for (const week of displayWeeks) {
      const date = week[dayIdx];
      if (!date || date > endDate || date < startDate) {
        line += ' ';
        continue;
      }
      const dateStr = formatDate(date);
      const tokens = usageMap.get(dateStr) ?? 0;
      const block = intensityBlock(tokens, maxTokens);
      const color = intensityColor(tokens, maxTokens);
      line += colorize(block, color, options.noColor);
    }

    // Trim to width (accounting for ANSI codes)
    lines.push(line);
  }

  // Legend
  const legendBlocks = [
    HEATMAP_BLOCKS.EMPTY,
    HEATMAP_BLOCKS.LIGHT,
    HEATMAP_BLOCKS.MEDIUM,
    HEATMAP_BLOCKS.DARK,
    HEATMAP_BLOCKS.FULL,
  ];
  const legend = `${' '.repeat(DAY_LABEL_WIDTH)}${LEGEND_TEXT} ${legendBlocks.join('')} ${LEGEND_TEXT_MORE}`;
  lines.push(legend);

  return lines.join('\n');
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
