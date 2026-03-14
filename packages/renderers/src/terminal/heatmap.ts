import type { DailyUsage } from '@tokenleak/core';
import { buildHeatmapModel } from '../shared/heatmap-model';
import { background256, dim } from './colors';
import { truncateVisible } from './layout';

const DAY_LABELS = ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'] as const;
const DAY_LABEL_WIDTH = 4;

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

type HeatmapDisplayMode = 'full' | 'compact';

interface HeatmapOptions {
  width: number;
  noColor: boolean;
}

function getDisplayMode(width: number): HeatmapDisplayMode {
  return width >= 56 ? 'full' : 'compact';
}

function getCellWidth(mode: HeatmapDisplayMode): number {
  return mode === 'full' ? 2 : 1;
}

function getWeekColumnWidth(mode: HeatmapDisplayMode): number {
  return getCellWidth(mode) + 1;
}

function buildMonthHeader(
  model: NonNullable<ReturnType<typeof buildHeatmapModel>>,
  visibleStartWeek: number,
  displayWeekCount: number,
  mode: HeatmapDisplayMode,
): { caption: string | null; line: string | null } {
  const weekColumnWidth = getWeekColumnWidth(mode);
  const header = Array.from({ length: displayWeekCount * weekColumnWidth }, () => ' ');
  let nextFreeIndex = 0;
  let placedLabels = 0;
  const visibleMarkers = model.monthMarkers.filter((marker) => marker.weekIndex >= visibleStartWeek);

  for (const marker of visibleMarkers) {
    const startIndex = Math.max((marker.weekIndex - visibleStartWeek) * weekColumnWidth, nextFreeIndex);
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

function renderCell(
  level: number,
  family: string | null,
  mode: HeatmapDisplayMode,
  noColor: boolean,
): string {
  const cellWidth = getCellWidth(mode);
  const blocks = mode === 'full'
    ? ['··', '░░', '▒▒', '▓▓', '██']
    : ['·', '░', '▒', '▓', '█'];
  const fallback = blocks[level] ?? blocks[0];

  if (noColor) {
    return fallback;
  }

  const palette = FAMILY_PALETTES[family ?? 'Other'] ?? FAMILY_PALETTES['Other'];
  const colorCode = level <= 0
    ? EMPTY_CELL_CODE
    : palette[Math.max(0, Math.min(palette.length - 1, level - 1))] ?? EMPTY_CELL_CODE;
  return background256(' '.repeat(cellWidth), colorCode, noColor);
}

function buildFamilyLegend(
  families: string[],
  mode: HeatmapDisplayMode,
  width: number,
  noColor: boolean,
): string[] {
  if (families.length === 0) {
    return [];
  }

  const cellWidth = getCellWidth(mode);
  const chunks = families.map((family) => {
    const palette = FAMILY_PALETTES[family] ?? FAMILY_PALETTES['Other'];
    const swatch = noColor
      ? (mode === 'full' ? '██' : '█')
      : background256(' '.repeat(cellWidth), palette[3] ?? EMPTY_CELL_CODE, noColor);
    return `${swatch} ${family}`;
  });

  const lines: string[] = [];
  let current = 'Models ';

  for (const chunk of chunks) {
    const candidate = current.length === 7 ? `${current}${chunk}` : `${current}  ${chunk}`;
    const visibleLength = candidate.replace(/\x1b\[[0-9;]*m/g, '').length;

    if (visibleLength > width && current.length > 7) {
      lines.push(current);
      current = `       ${chunk}`;
      continue;
    }

    current = candidate;
  }

  lines.push(current);
  return lines;
}

function buildHighlightLine(
  visibleWeeks: NonNullable<ReturnType<typeof buildHeatmapModel>>['weeks'],
  width: number,
  noColor: boolean,
): string | null {
  const cells = visibleWeeks.flatMap((week) => week.days).filter((cell) => cell.tokens > 0);
  if (cells.length === 0) {
    return null;
  }

  const peak = cells.reduce((best, cell) => (cell.tokens > best.tokens ? cell : best));
  const familyDays = new Map<string, number>();
  let mixedDays = 0;

  for (const cell of cells) {
    if (cell.dominantModelFamily) {
      familyDays.set(cell.dominantModelFamily, (familyDays.get(cell.dominantModelFamily) ?? 0) + 1);
    }
    if (cell.mixedModelCount > 1) {
      mixedDays += 1;
    }
  }

  const [topFamily = 'None'] = [...familyDays.entries()].sort((left, right) => right[1] - left[1])[0] ?? [];
  const summary = `Highlights  Peak ${peak.date} ${peak.tokens.toLocaleString()} tok  |  Lead ${topFamily}  |  Mixed ${mixedDays}d`;
  return noColor ? truncateVisible(summary, width) : dim(truncateVisible(summary, width), noColor);
}

function buildStoryLines(
  visibleWeeks: NonNullable<ReturnType<typeof buildHeatmapModel>>['weeks'],
  width: number,
  noColor: boolean,
): string[] {
  const cells = visibleWeeks.flatMap((week) => week.days);
  const activeCells = cells.filter((cell) => cell.tokens > 0);
  if (activeCells.length === 0) {
    return [];
  }

  const spendDay = activeCells.reduce((best, cell) => (cell.cost > best.cost ? cell : best));
  const lastActive = activeCells[activeCells.length - 1] ?? activeCells[0]!;
  const firstModelCell = activeCells.find((cell) => cell.dominantModelLabel);

  let currentStreak = 0;
  let longestStreak = 0;
  for (const cell of cells) {
    if (cell.tokens > 0) {
      currentStreak += 1;
      longestStreak = Math.max(longestStreak, currentStreak);
      continue;
    }
    currentStreak = 0;
  }

  const weekTotals = visibleWeeks.map((week) => ({
    startDate: week.days[0]?.date ?? '',
    totalTokens: week.days.reduce((sum, cell) => sum + cell.tokens, 0),
  }));
  const hottestWeek = weekTotals.reduce((best, week) => (week.totalTokens > best.totalTokens ? week : best));
  const recentWindow = cells.slice(-7);
  const previousWindow = cells.slice(-14, -7);
  const recentTokens = recentWindow.reduce((sum, cell) => sum + cell.tokens, 0);
  const previousTokens = previousWindow.reduce((sum, cell) => sum + cell.tokens, 0);
  const weeklyPulse = previousWindow.length === 0
    ? null
    : recentTokens - previousTokens;
  const weeklyPulseText = weeklyPulse === null
    ? 'new window'
    : weeklyPulse === 0
      ? 'flat vs prior week'
      : `${weeklyPulse > 0 ? '+' : '-'}${Math.abs(weeklyPulse).toLocaleString()} tok vs prior week`;

  const lines = [
    `Story  Spend ${spendDay.date} $${spendDay.cost.toFixed(2)}  |  Streak ${longestStreak}d  |  Last ${lastActive.date}`,
    `Pulse  ${weeklyPulseText}  |  Hot week ${hottestWeek.startDate} ${hottestWeek.totalTokens.toLocaleString()} tok`,
  ];

  if (firstModelCell?.dominantModelLabel) {
    lines.push(
      `Models  First lead ${firstModelCell.dominantModelLabel} on ${firstModelCell.date}  |  Last lead ${lastActive.dominantModelLabel ?? 'n/a'}`,
    );
  }

  return lines.map((line) => (noColor ? truncateVisible(line, width) : dim(truncateVisible(line, width), noColor)));
}

export function renderTerminalHeatmap(
  daily: DailyUsage[],
  options: HeatmapOptions,
): string {
  const model = buildHeatmapModel(daily);
  if (!model) {
    return '  No usage data available in the selected range.';
  }

  const displayMode = getDisplayMode(options.width);
  const weekColumnWidth = getWeekColumnWidth(displayMode);
  const availableColumns = Math.max(weekColumnWidth, options.width - DAY_LABEL_WIDTH);
  const maxWeeks = Math.max(1, Math.floor(availableColumns / weekColumnWidth));
  const displayWeeks = model.weeks.slice(Math.max(0, model.weeks.length - maxWeeks));
  const visibleStartWeek = model.weeks.length - displayWeeks.length;
  const { caption, line } = buildMonthHeader(model, visibleStartWeek, displayWeeks.length, displayMode);
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
      const cell = week.days[dayIndex] ?? {
        level: 0,
        tokens: 0,
        dominantModelFamily: null,
      };
      row += `${renderCell(cell.level, cell.dominantModelFamily, displayMode, options.noColor)} `;
    }

    lines.push(row.trimEnd());
  }

  const intensityBlocks = displayMode === 'full'
    ? ['··', '░░', '▒▒', '▓▓', '██']
    : ['·', '░', '▒', '▓', '█'];
  lines.push(`${' '.repeat(DAY_LABEL_WIDTH)}Intensity ${intensityBlocks.join(' ')} `);

  const visibleFamilies = Array.from(
    new Set(
      displayWeeks
        .flatMap((week) => week.days)
        .map((cell) => cell.dominantModelFamily)
        .filter((family): family is string => family !== null),
    ),
  );
  lines.push(...buildFamilyLegend(visibleFamilies, displayMode, options.width, options.noColor));

  const highlightLine = buildHighlightLine(displayWeeks, options.width, options.noColor);
  if (highlightLine) {
    lines.push(highlightLine);
  }
  lines.push(...buildStoryLines(displayWeeks, options.width, options.noColor));

  return lines.join('\n');
}
