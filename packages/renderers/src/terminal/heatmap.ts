import type { DailyUsage } from '@tokenleak/core';
import { buildHeatmapModel } from '../shared/heatmap-model';
import type { AnsiColor } from './ansi';
import { colorize, HEATMAP_BLOCKS } from './ansi';

const DAY_LABEL_WIDTH = 5;
const LABELED_DAYS: Record<number, string> = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };
const FULL_MODE_THRESHOLD = 40;

const LEVEL_COLORS: AnsiColor[] = ['dim', 'dim', 'cyan', 'yellow', 'green'];

type DisplayMode = 'full' | 'compact';

interface HeatmapOptions {
  width: number;
  noColor: boolean;
}

function getDisplayMode(width: number): DisplayMode {
  return width >= FULL_MODE_THRESHOLD ? 'full' : 'compact';
}

function getCellWidth(mode: DisplayMode): number {
  return mode === 'full' ? 2 : 1;
}

function getGap(mode: DisplayMode): string {
  return mode === 'full' ? ' ' : '';
}

function getWeekColumnWidth(mode: DisplayMode): number {
  return getCellWidth(mode) + getGap(mode).length;
}

function renderCell(
  level: number,
  mode: DisplayMode,
  noColor: boolean,
): string {
  const blocks = [
    HEATMAP_BLOCKS.EMPTY,
    HEATMAP_BLOCKS.LIGHT,
    HEATMAP_BLOCKS.MEDIUM,
    HEATMAP_BLOCKS.DARK,
    HEATMAP_BLOCKS.FULL,
  ];
  const block = blocks[level] ?? HEATMAP_BLOCKS.EMPTY;
  const cellWidth = getCellWidth(mode);
  return cellWidth === 2 ? block + block : block;
}

function buildMonthHeader(
  model: NonNullable<ReturnType<typeof buildHeatmapModel>>,
  visibleStartWeek: number,
  displayWeekCount: number,
  mode: DisplayMode,
): { caption: string | null; line: string | null } {
  const weekColWidth = getWeekColumnWidth(mode);
  const totalCols = displayWeekCount * weekColWidth;
  const header = Array.from({ length: totalCols }, () => ' ');
  let nextFreeIndex = 0;
  let placedLabels = 0;
  const visibleMarkers = model.monthMarkers.filter(
    (marker) => marker.weekIndex >= visibleStartWeek,
  );

  for (const marker of visibleMarkers) {
    const startIndex = Math.max(
      (marker.weekIndex - visibleStartWeek) * weekColWidth,
      nextFreeIndex,
    );
    const remaining = header.length - startIndex;
    if (remaining < 3) continue;

    for (let offset = 0; offset < marker.label.length; offset += 1) {
      if (startIndex + offset < header.length) {
        header[startIndex + offset] = marker.label[offset] ?? ' ';
      }
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

  const caption =
    placedLabels === 0 && uniqueVisibleMonths.length === 1
      ? `${' '.repeat(DAY_LABEL_WIDTH)}${uniqueVisibleMonths[0]}`
      : null;

  return { caption, line };
}

function buildLegendLine(mode: DisplayMode, noColor: boolean): string {
  const blocks = [
    HEATMAP_BLOCKS.EMPTY,
    HEATMAP_BLOCKS.LIGHT,
    HEATMAP_BLOCKS.MEDIUM,
    HEATMAP_BLOCKS.DARK,
    HEATMAP_BLOCKS.FULL,
  ];
  const cellWidth = getCellWidth(mode);
  const gap = getGap(mode);
  const renderedBlocks = blocks.map((block, level) => {
    const text = cellWidth === 2 ? block + block : block;
    const color = LEVEL_COLORS[level] ?? 'dim';
    return colorize(text, color, noColor);
  });
  return `${' '.repeat(DAY_LABEL_WIDTH)}Less ${renderedBlocks.join(gap)} More`;
}

export function renderTerminalHeatmap(
  daily: DailyUsage[],
  options: HeatmapOptions,
): string {
  const model = buildHeatmapModel(daily);
  if (!model) {
    return '  No usage data available in the selected range.';
  }

  const mode = getDisplayMode(options.width);
  const weekColWidth = getWeekColumnWidth(mode);
  const availableColumns = Math.max(weekColWidth, options.width - DAY_LABEL_WIDTH);
  const maxWeeks = Math.max(1, Math.floor(availableColumns / weekColWidth));
  const displayWeeks = model.weeks.slice(Math.max(0, model.weeks.length - maxWeeks));
  const visibleStartWeek = model.weeks.length - displayWeeks.length;

  const { caption, line } = buildMonthHeader(model, visibleStartWeek, displayWeeks.length, mode);
  const lines: string[] = [];

  if (caption) lines.push(caption);
  if (line) lines.push(line);

  const gap = getGap(mode);

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const label = LABELED_DAYS[dayIndex] ?? '';
    const paddedLabel = (label + ' '.repeat(DAY_LABEL_WIDTH)).slice(0, DAY_LABEL_WIDTH);
    const cells: string[] = [];

    for (const week of displayWeeks) {
      const cell = week.days[dayIndex] ?? { level: 0, tokens: 0 };
      const color = LEVEL_COLORS[cell.level] ?? 'dim';
      const rendered = renderCell(cell.level, mode, options.noColor);
      cells.push(colorize(rendered, color, options.noColor));
    }

    const row = paddedLabel + cells.join(gap);
    lines.push(row.trimEnd());
  }

  lines.push('');
  lines.push(buildLegendLine(mode, options.noColor));

  return lines.join('\n');
}
