import { describe, expect, test } from 'bun:test';
import { CHROME_ROWS, contentRows, fitItems } from './layout';

describe('contentRows', () => {
  test('subtracts the chrome and the Cursor banner', () => {
    expect(contentRows(36, false)).toBe(36 - CHROME_ROWS);
    expect(contentRows(36, true)).toBe(36 - CHROME_ROWS - 1);
  });

  test('never goes below zero on a tiny terminal', () => {
    expect(contentRows(1, true)).toBe(0);
  });
});

describe('fitItems', () => {
  test('fits whole items after the fixed rows', () => {
    expect(fitItems(34, 10, 4, 8)).toBe(6);
    expect(fitItems(30, 10, 4, 8)).toBe(5);
  });

  test('caps at the maximum on tall terminals', () => {
    expect(fitItems(200, 10, 4, 8)).toBe(8);
  });

  test('keeps at least one item on a cramped terminal', () => {
    expect(fitItems(5, 10, 4, 8)).toBe(1);
  });

  test('an unknown height fits the maximum', () => {
    expect(fitItems(Number.NaN, 10, 4, 8)).toBe(8);
    expect(fitItems(Number.POSITIVE_INFINITY, 10, 4, 8)).toBe(8);
  });
});
