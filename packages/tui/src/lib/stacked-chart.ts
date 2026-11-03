import type { StackedSeries } from './overview-model.js';

/** Lower-eighth block characters; index n fills n/8 of a cell from the bottom. */
const EIGHTHS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
const SUBCELLS = EIGHTHS.length - 1;
/** Bars never get wider than this, however few days there are. */
const MAX_BAR_WIDTH = 6;

export interface ChartCell {
  char: string;
  /** Series index drawn in the cell's lower part, or null for an empty cell. */
  fg: number | null;
  /** Series index above it inside the same cell, or null for empty space. */
  bg: number | null;
}

export interface ChartColumn {
  /** First date the column covers. */
  date: string;
  values: number[];
  total: number;
}

export interface ChartLayout {
  columns: ChartColumn[];
  /** Cells each column's bar takes, in column order. */
  widths: number[];
  /** Blank cells between neighbouring bars. */
  gap: number;
}

/**
 * Fits the series into `width` cells. Few days get bars up to
 * {@link MAX_BAR_WIDTH} wide with a one-cell gap. Up to one day per cell, the
 * width is shared out so the bars span the whole chart. More days than cells
 * are summed into columns of consecutive days.
 */
export function layoutColumns(series: StackedSeries, width: number): ChartLayout {
  const days = series.days;
  const usable = Math.max(1, width);
  if (days.length === 0) return { columns: [], widths: [], gap: 0 };

  const slot = Math.floor(usable / days.length);
  if (slot >= 2) {
    const barWidth = Math.min(MAX_BAR_WIDTH, slot - 1);
    return {
      columns: days.map((day) => ({ date: day.date, values: day.values, total: day.total })),
      widths: days.map(() => barWidth),
      gap: 1,
    };
  }

  if (days.length <= usable) {
    // Column i spans cells [floor(i·w/n), floor((i+1)·w/n)): widths differ by at most one.
    return {
      columns: days.map((day) => ({ date: day.date, values: day.values, total: day.total })),
      widths: days.map((_, index) =>
        Math.floor(((index + 1) * usable) / days.length) - Math.floor((index * usable) / days.length),
      ),
      gap: 0,
    };
  }

  const perColumn = Math.ceil(days.length / usable);
  const columns: ChartColumn[] = [];
  for (let start = 0; start < days.length; start += perColumn) {
    const group = days.slice(start, start + perColumn);
    const values = series.models.map((_, index) => group.reduce((sum, day) => sum + (day.values[index] ?? 0), 0));
    columns.push({ date: group[0]!.date, values, total: values.reduce((sum, value) => sum + value, 0) });
  }
  return { columns, widths: columns.map(() => 1), gap: 0 };
}

/**
 * The cells of one bar, bottom row first. Segments are stacked in series
 * order and measured in eighths of a cell. A cell holding a boundary draws the
 * lower segment as a partial block in the foreground and shows the segment
 * above it through the background, so stacks stay exact to an eighth.
 */
export function barCells(values: readonly number[], max: number, height: number): ChartCell[] {
  const units = height * SUBCELLS;
  const scale = max > 0 ? units / max : 0;
  const bounds: number[] = [];
  let running = 0;
  for (const value of values) {
    running += value;
    bounds.push(Math.round(running * scale));
  }

  const segmentAt = (unit: number): number | null => {
    for (let index = 0; index < bounds.length; index++) {
      if (unit < bounds[index]!) return index;
    }
    return null;
  };

  const cells: ChartCell[] = [];
  for (let row = 0; row < height; row++) {
    const bottom = row * SUBCELLS;
    const lower = segmentAt(bottom);
    if (lower === null) {
      cells.push({ char: EIGHTHS[0], fg: null, bg: null });
      continue;
    }
    const lowerEnd = Math.min(bounds[lower]!, bottom + SUBCELLS);
    const filled = lowerEnd - bottom;
    cells.push({
      char: EIGHTHS[filled]!,
      fg: lower,
      bg: filled < SUBCELLS ? segmentAt(lowerEnd) : null,
    });
  }
  return cells;
}

/** Chart rows top to bottom, each a list of cells across every column. */
export function chartRows(layout: ChartLayout, max: number, height: number): ChartCell[][] {
  const bars = layout.columns.map((column) => barCells(column.values, max, height));
  const rows: ChartCell[][] = [];
  for (let row = height - 1; row >= 0; row--) {
    const cells: ChartCell[] = [];
    bars.forEach((bar, index) => {
      if (index > 0) for (let g = 0; g < layout.gap; g++) cells.push({ char: ' ', fg: null, bg: null });
      for (let w = 0; w < layout.widths[index]!; w++) cells.push(bar[row]!);
    });
    rows.push(cells);
  }
  return rows;
}
