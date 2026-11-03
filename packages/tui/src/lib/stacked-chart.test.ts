import { describe, expect, test } from 'bun:test';
import type { StackedSeries } from './overview-model';
import { barCells, chartRows, layoutColumns } from './stacked-chart';

function series(totals: number[][]): StackedSeries {
  const days = totals.map((values, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, '0')}`,
    values,
    total: values.reduce((sum, value) => sum + value, 0),
  }));
  return { models: totals[0]?.map((_, i) => `m${i}`) ?? [], days, max: Math.max(0, ...days.map((d) => d.total)) };
}

describe('layoutColumns', () => {
  test('few days get gapped bars capped in width', () => {
    const layout = layoutColumns(series([[1], [2]]), 100);
    expect(layout.widths).toEqual([6, 6]);
    expect(layout.gap).toBe(1);
  });

  test('up to one day per cell spreads the width so bars fill the chart', () => {
    const layout = layoutColumns(series(Array.from({ length: 90 }, () => [1])), 139);
    expect(layout.gap).toBe(0);
    expect(layout.widths.reduce((a, b) => a + b, 0)).toBe(139);
    expect(Math.max(...layout.widths) - Math.min(...layout.widths)).toBeLessThanOrEqual(1);
  });

  test('more days than cells are summed into columns', () => {
    const layout = layoutColumns(series(Array.from({ length: 10 }, (_, i) => [i])), 4);
    expect(layout.columns.length).toBe(4);
    expect(layout.columns.reduce((sum, column) => sum + column.total, 0)).toBe(45);
  });

  test('an empty series has no columns', () => {
    expect(layoutColumns(series([]), 50).columns).toEqual([]);
  });
});

describe('barCells', () => {
  test('a full bar fills every cell with its series', () => {
    expect(barCells([4], 4, 2)).toEqual([
      { char: '█', fg: 0, bg: null },
      { char: '█', fg: 0, bg: null },
    ]);
  });

  test('a boundary inside a cell shows the upper series through the background', () => {
    // 3/8 of one cell for series 0, then 5/8 for series 1.
    expect(barCells([3, 5], 8, 1)).toEqual([{ char: '▃', fg: 0, bg: 1 }]);
  });

  test('a partial top cell leaves empty space above', () => {
    expect(barCells([4], 8, 1)).toEqual([{ char: '▄', fg: 0, bg: null }]);
  });

  test('zero values and a zero max draw nothing', () => {
    expect(barCells([0], 10, 2).every((cell) => cell.fg === null)).toBe(true);
    expect(barCells([5], 0, 1)).toEqual([{ char: ' ', fg: null, bg: null }]);
  });
});

describe('chartRows', () => {
  test('rows run top to bottom with gaps between bars', () => {
    const data = series([[2], [1]]);
    const rows = chartRows(layoutColumns(data, 4), data.max, 2);
    expect(rows.map((row) => row.map((cell) => cell.char).join(''))).toEqual(['█  ', '█ █']);
  });
});
