import { describe, expect, test } from 'bun:test';
import { formatVsAverage } from './explain';

describe('formatVsAverage', () => {
  test('turns an absolute delta into a percentage of the average', () => {
    // 1.02B today vs a 295M average: +725M is +246%, not +72,491,390,614%.
    expect(formatVsAverage(1_020_000_000, 725_000_000)).toBe('+246%');
  });

  test('negative deltas read as drops', () => {
    expect(formatVsAverage(50, -50)).toBe('-50%');
  });

  test('a day equal to its average is +0%', () => {
    expect(formatVsAverage(100, 0)).toBe('+0%');
  });

  test('usage with no prior baseline is new, not infinite', () => {
    expect(formatVsAverage(500, 500)).toBe('new');
  });

  test('no usage and no baseline is 0%', () => {
    expect(formatVsAverage(0, 0)).toBe('0%');
  });
});
