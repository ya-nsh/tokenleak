import { describe, expect, test } from 'bun:test';
import { formatTokenCount, formatUsd } from './format';

describe('formatTokenCount', () => {
  test.each([
    [0, '0'],
    [999, '999'],
    [999.6, '1.0K'],
    [1_000, '1.0K'],
    [12_345, '12.3K'],
    [99_940, '99.9K'],
    [99_960, '100K'],
    [404_000, '404K'],
    [999_499, '999K'],
    [999_500, '1.0M'],
    [117_200_000, '117M'],
    [1_330_400_000, '1.3B'],
    [15_893_400_000, '15.9B'],
    [2_500_000_000_000, '2.5T'],
    [-1_500, '-1.5K'],
  ])('%d → %s', (value, expected) => {
    expect(formatTokenCount(value)).toBe(expected);
  });

  test('non-finite values render as zero', () => {
    expect(formatTokenCount(Number.NaN)).toBe('0');
    expect(formatTokenCount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('formatUsd', () => {
  test.each([
    [0, '$0.00'],
    [0.004, '<$0.01'],
    [0.01, '$0.01'],
    [12.345, '$12.35'],
    [999.99, '$999.99'],
    [1_234.5, '$1,235'],
    [-5, '-$5.00'],
  ])('%d → %s', (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });

  test('NaN renders as zero dollars', () => {
    expect(formatUsd(Number.NaN)).toBe('$0.00');
  });
});
