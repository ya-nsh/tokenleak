import { describe, expect, test } from 'bun:test';
import { fitLegend, overviewLayout, shareBar, tableListRows } from './overview';

describe('overviewLayout', () => {
  test('wide terminals put tables side by side and give spare rows to the chart', () => {
    const layout = overviewLayout(150, 41, 5);
    expect(layout.sideBySide).toBe(true);
    expect(layout.tableRows).toBeGreaterThanOrEqual(5);
    expect(layout.plotRows).toBeGreaterThan(10);
  });

  test('narrow terminals stack the tables', () => {
    expect(overviewLayout(100, 30, 5).sideBySide).toBe(false);
  });

  test('tiny terminals keep a minimum chart and at least one table row', () => {
    const layout = overviewLayout(60, 10, 20);
    expect(layout.plotRows).toBe(3);
    expect(layout.tableRows).toBeGreaterThanOrEqual(1);
  });
});

describe('shareBar', () => {
  test('is exact to an eighth and always the requested width', () => {
    expect(shareBar(1, 4)).toBe('████');
    expect(shareBar(0.5, 3)).toBe('█▌ ');
    expect(shareBar(0, 3)).toBe('   ');
    expect(shareBar(2, 2)).toBe('██');
  });
});

describe('tableListRows', () => {
  test('reserves a row for the more line only when entries overflow', () => {
    expect(tableListRows(3, 5)).toBe(5);
    expect(tableListRows(8, 5)).toBe(4);
    expect(tableListRows(8, 1)).toBe(1);
  });
});

describe('fitLegend', () => {
  test('keeps names that fit and counts the rest', () => {
    expect(fitLegend(['alpha', 'beta', 'gamma'], 100)).toEqual({ shown: ['alpha', 'beta', 'gamma'], hidden: 0 });
    expect(fitLegend(['alpha', 'beta', 'gamma'], 20)).toEqual({ shown: ['alpha'], hidden: 2 });
    expect(fitLegend(['a-very-long-model-name'], 5).shown).toHaveLength(1);
  });
});
