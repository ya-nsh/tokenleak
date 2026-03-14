import type { DailyUsage } from '@tokenleak/core';
import { buildHeatmapModel } from '../shared/heatmap-model';
import { colorize, intensityColor, HEATMAP_BLOCKS } from './ansi';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAY_LABEL_WIDTH = 4;
const WEEK_COLUMN_WIDTH = 2;
const LEGEND_TEXT = 'Less';
const LEGEND_TEXT_MORE = 'More';

interface HeatmapOptions {
  width: number;
  noColor: boolean;
}

function buildMonthHeader(
  model: NonNullable<ReturnType<typeof buildHeatmapModel>>,
  visibleStartWeek: number,
  displayWeekCount: number,
): { caption: string | null; line: string | null } {
  const header = Array.from({ length: displayWeekCount * WEEK_COLUMN_WIDTH }, () => ' ');
  let nextFreeIndex = 0;
  let placedLabels = 0;
  const visibleMarkers = model.monthMarkers.filter((marker) => marker.weekIndex >= visibleStartWeek);

  for (const marker of visibleMarkers) {
    const startIndex = Math.max((marker.weekIndex - visibleStartWeek) * WEEK_COLUMN_WIDTH, nextFreeIndex);
    const remaining = header.length - startIndex;
    if (remaining < 3) {
      continue;
    }

    for (let offset = 0; offset < marker.label.length; offset += 1) {
      header[startIndex + offset] = marker.label[offset] ?? ' ';
    }
    nextFreeIndex = startIndex + marker.label.length + 1;
    placedLabels += 1;
  }

  const line = header.some((cell) => cell !== ' ')
    ? `${' '.repeat(DAY_LABEL_WIDTH)}${header.join('')}`
    : null;
  const uniqueVisibleMonths = visibleMarkers
    .map((marker) => `${marker.label} ${String(marker.year)}`)
    .filter((value, index, values) => values.indexOf(value) === index);
  const caption = placedLabels === 0 && uniqueVisibleMonths.length === 1
    ? `  ${uniqueVisibleMonths[0]}`
    : null;

  return { caption, line };
}

export function renderTerminalHeatmap(
  daily: DailyUsage[],
  options: HeatmapOptions,
): string {
  const model = buildHeatmapModel(daily);
  if (!model) {
    return '  No usage data available in the selected range.';
  }

  const availableColumns = Math.max(WEEK_COLUMN_WIDTH, options.width - DAY_LABEL_WIDTH);
  const maxWeeks = Math.max(1, Math.floor(availableColumns / WEEK_COLUMN_WIDTH));
  const displayWeeks = model.weeks.slice(Math.max(0, model.weeks.length - maxWeeks));
  const visibleStartWeek = model.weeks.length - displayWeeks.length;
  const { caption, line } = buildMonthHeader(model, visibleStartWeek, displayWeeks.length);
  const lines: string[] = [];

  if (caption) {
    lines.push(caption);
  }
  if (line) {
    lines.push(line);
  }

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const label = DAY_LABELS[dayIndex] ?? '   ';
    let row = `${label} `.slice(0, DAY_LABEL_WIDTH);

    for (const week of displayWeeks) {
      const cell = week.days[dayIndex] ?? { level: 0, tokens: 0 };
      const block = [
        HEATMAP_BLOCKS.EMPTY,
        HEATMAP_BLOCKS.LIGHT,
        HEATMAP_BLOCKS.MEDIUM,
        HEATMAP_BLOCKS.DARK,
        HEATMAP_BLOCKS.FULL,
      ][cell.level] ?? HEATMAP_BLOCKS.EMPTY;
      const color = intensityColor(cell.tokens, model.maxTokens);
      row += `${colorize(block, color, options.noColor)} `;
    }

    lines.push(row.trimEnd());
  }

  lines.push(`${' '.repeat(DAY_LABEL_WIDTH)}${LEGEND_TEXT} ${[
    HEATMAP_BLOCKS.EMPTY,
    HEATMAP_BLOCKS.LIGHT,
    HEATMAP_BLOCKS.MEDIUM,
    HEATMAP_BLOCKS.DARK,
    HEATMAP_BLOCKS.FULL,
  ].join('')} ${LEGEND_TEXT_MORE}`);

  return lines.join('\n');
}
