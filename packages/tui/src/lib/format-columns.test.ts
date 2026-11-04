import { describe, expect, test } from 'bun:test';
import { formatRatio, rightColumn } from './format';

describe('rightColumn', () => {
  test('right-aligns a short value in the full width', () => {
    expect(rightColumn('0.48', 6)).toBe('  0.48');
  });

  test('keeps a gap when the value fills the column', () => {
    // The old padLeft gave '682.11' here, touching the previous column.
    const cell = rightColumn('682.11', 6);
    expect(cell.startsWith(' ')).toBe(true);
    expect(cell.trim()).toBe('682.11');
  });

  test('never cuts a value wider than the column', () => {
    expect(rightColumn('$12,345', 5)).toBe(' $12,345');
  });

  test('handles zero and one-cell widths', () => {
    expect(rightColumn('x', 0)).toBe(' x');
    expect(rightColumn('', 1)).toBe(' ');
  });
});

describe('formatRatio', () => {
  test.each([
    [0, '0.00'],
    [0.481, '0.48'],
    [9.99, '9.99'],
    [10, '10.0'],
    [54.57, '54.6'],
    [99.94, '99.9'],
    [100, '100'],
    [682.11, '682'],
    [999.4, '999'],
    [1_000, '1.0k'],
    [1_234, '1.2k'],
    [9_949, '9.9k'],
    [10_000, '10k'],
    [45_210, '45k'],
    [-2.5, '-2.50'],
  ])('%p -> %p', (value, expected) => {
    expect(formatRatio(value)).toBe(expected);
  });

  test('fits a five-cell column across the whole range', () => {
    for (const value of [0.001, 9.999, 99.99, 999.9, 9_999, 99_999]) {
      expect(formatRatio(value).length).toBeLessThanOrEqual(5);
    }
  });

  test('shows a dash for values that are not finite', () => {
    expect(formatRatio(Number.NaN)).toBe('-');
    expect(formatRatio(Number.POSITIVE_INFINITY)).toBe('-');
  });
});
