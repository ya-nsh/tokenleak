import type { DailyUsage } from '@tokenleak/core';
import { buildHeatmapModel } from '../shared/heatmap-model';
import { background256 } from './colors';
import { visibleLength } from './layout';

const DAY_LABEL_WIDTH = 5;
const LABELED_DAYS: Record<number, string> = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };
const FULL_MODE_THRESHOLD = 40;

const EMPTY_CELL_CODE = 237;
const FAMILY_PALETTES: Record<string, readonly [number, number, number, number]> = {
  Claude: [223, 215, 208, 166],
  GPT: [120, 78, 42, 35],
  Gemini: [189, 147, 105, 99],
  Llama: [153, 111, 69, 27],
  DeepSeek: [159, 117, 81, 45],
  Qwen: [225, 183, 141, 97],
  Other: [252, 250, 247, 244],
} as const;

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
  family: string | null,
  mode: DisplayMode,
  noColor: boolean,
): string {
  const cellWidth = getCellWidth(mode);

  if (noColor) {
    const blocks = mode === 'full'
      ? ['··', '░░', '▒▒', '▓▓', '██']
      : ['·', '░', '▒', '▓', '█'];
    return blocks[level] ?? blocks[0]!;
  }

  const palette = FAMILY_PALETTES[family ?? 'Other'] ?? FAMILY_PALETTES['Other']!;
  const colorCode = level <= 0
    ? EMPTY_CELL_CODE
    : palette[Math.max(0, Math.min(palette.length - 1, level - 1))] ?? EMPTY_CELL_CODE;
  return background256(' '.repeat(cellWidth), colorCode, noColor);
}

function getPrimaryFamily(
  visibleWeeks: NonNullable<ReturnType<typeof buildHeatmapModel>>['weeks'],
): string {
  const familyDays = new Map<string, number>();
  for (const cell of visibleWeeks.flatMap((week) => week.days)) {
    if (!cell.dominantModelFamily) continue;
    familyDays.set(cell.dominantModelFamily, (familyDays.get(cell.dominantModelFamily) ?? 0) + 1);
  }
  return [...familyDays.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'Other';
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

function buildIntensityLegend(
  family: string,
  mode: DisplayMode,
  noColor: boolean,
): string {
  const cellWidth = getCellWidth(mode);
  const palette = FAMILY_PALETTES[family] ?? FAMILY_PALETTES.Other!;
  const gap = getGap(mode);

  const swatches = noColor
    ? (mode === 'full' ? ['··', '░░', '▒▒', '▓▓', '██'] : ['·', '░', '▒', '▓', '█'])
    : [
        background256(' '.repeat(cellWidth), EMPTY_CELL_CODE, noColor),
        background256(' '.repeat(cellWidth), palette[0], noColor),
        background256(' '.repeat(cellWidth), palette[1], noColor),
        background256(' '.repeat(cellWidth), palette[2], noColor),
        background256(' '.repeat(cellWidth), palette[3], noColor),
      ];

  return `Less ${swatches.join(gap)} More`;
}

function buildFamilyLegend(
  families: string[],
  mode: DisplayMode,
  width: number,
  noColor: boolean,
): string[] {
  if (families.length === 0) return [];

  const cellWidth = getCellWidth(mode);
  const chunks = families.map((family) => {
    const palette = FAMILY_PALETTES[family] ?? FAMILY_PALETTES['Other']!;
    const swatch = noColor
      ? (mode === 'full' ? '██' : '█')
      : background256(' '.repeat(cellWidth), palette[3] ?? EMPTY_CELL_CODE, noColor);
    return `${swatch} ${family}`;
  });

  const lines: string[] = [];
  let current = '';

  for (const chunk of chunks) {
    const candidate = current.length === 0 ? chunk : `${current}  ${chunk}`;
    if (visibleLength(candidate) > width && current.length > 0) {
      lines.push(current);
      current = chunk;
      continue;
    }
    current = candidate;
  }

  lines.push(current);
  return lines;
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
      const cell = week.days[dayIndex] ?? {
        level: 0,
        tokens: 0,
        dominantModelFamily: null,
      };
      cells.push(renderCell(cell.level, cell.dominantModelFamily, mode, options.noColor));
    }

    const row = paddedLabel + cells.join(gap);
    lines.push(row.trimEnd());
  }

  const visibleFamilies = Array.from(
    new Set(
      displayWeeks
        .flatMap((week) => week.days)
        .map((cell) => cell.dominantModelFamily)
        .filter((family): family is string => family !== null),
    ),
  );
  const primaryFamily = getPrimaryFamily(displayWeeks);

  lines.push('');
  const intensityLegend = buildIntensityLegend(primaryFamily, mode, options.noColor);
  const familyLines = buildFamilyLegend(visibleFamilies, mode, options.width - DAY_LABEL_WIDTH, options.noColor);

  // Try to fit intensity + family legend on one line
  if (familyLines.length === 1) {
    const combined = `${intensityLegend}   ${familyLines[0]}`;
    if (visibleLength(combined) <= options.width - DAY_LABEL_WIDTH) {
      lines.push(`${' '.repeat(DAY_LABEL_WIDTH)}${combined}`);
      return lines.join('\n');
    }
  }

  lines.push(`${' '.repeat(DAY_LABEL_WIDTH)}${intensityLegend}`);
  if (familyLines.length > 0) {
    for (const familyLine of familyLines) {
      lines.push(`${' '.repeat(DAY_LABEL_WIDTH)}${familyLine}`);
    }
  }

  return lines.join('\n');
}
