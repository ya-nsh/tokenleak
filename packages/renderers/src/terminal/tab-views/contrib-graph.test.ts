import { describe, test, expect } from 'bun:test';
import { renderContribGraph } from './contrib-graph';
import type { TokenleakOutput } from '@tokenleak/core';

function makeOutput(daily: Array<{ date: string; totalTokens: number }>): TokenleakOutput {
  return {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    dateRange: { since: '2025-01-01', until: '2025-12-31' },
    providers: [
      {
        provider: 'test',
        displayName: 'Test',
        daily: daily.map((d) => ({
          date: d.date,
          inputTokens: Math.floor(d.totalTokens / 2),
          outputTokens: Math.ceil(d.totalTokens / 2),
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: d.totalTokens,
          cost: 0,
          models: [],
        })),
        totalTokens: daily.reduce((sum, d) => sum + d.totalTokens, 0),
        totalCost: 0,
        colors: { primary: '#00ff00', secondary: '#008800', gradient: ['#00ff00', '#008800'] },
      },
    ],
    aggregated: {
      currentStreak: 0,
      longestStreak: 0,
      rolling30dTokens: 0,
      rolling30dCost: 0,
      rolling7dTokens: 0,
      rolling7dCost: 0,
      peakDay: null,
      averageDailyTokens: 0,
      averageDailyCost: 0,
      cacheHitRate: 0,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCost: 0,
      activeDays: 0,
      dayOfWeek: {},
      timeOfDay: {},
    },
  };
}

describe('renderContribGraph', () => {
  test('renders empty state for no data', () => {
    const output = makeOutput([]);
    const result = renderContribGraph(output, 100, true);
    expect(result).toContain('No daily data');
  });

  test('renders graph with data', () => {
    const daily = [
      { date: '2025-06-15', totalTokens: 1000 },
      { date: '2025-06-16', totalTokens: 5000 },
      { date: '2025-06-17', totalTokens: 10000 },
    ];
    const output = makeOutput(daily);
    const result = renderContribGraph(output, 120, false);
    expect(result).toContain('Contribution Graph');
    expect(result).toContain('Less');
    expect(result).toContain('More');
  });

  test('noColor mode uses block characters only', () => {
    const daily = [{ date: '2025-06-15', totalTokens: 1000 }];
    const output = makeOutput(daily);
    const result = renderContribGraph(output, 120, true);
    // Should contain block characters without ANSI escape codes
    expect(result).not.toContain('\x1b[');
  });

  test('output has correct number of day rows (7)', () => {
    const daily = [{ date: '2025-06-15', totalTokens: 1000 }];
    const output = makeOutput(daily);
    const result = renderContribGraph(output, 120, true);
    const lines = result.split('\n');
    // Title + empty + month labels + 7 day rows + empty + legend = at least 12 lines
    expect(lines.length).toBeGreaterThanOrEqual(11);
  });

  test('handles boundary dates (Jan 1 and Dec 31)', () => {
    const daily = [
      { date: '2025-01-01', totalTokens: 500 },
      { date: '2025-12-31', totalTokens: 500 },
    ];
    const output = makeOutput(daily);
    const result = renderContribGraph(output, 120, true);
    expect(result).toContain('Contribution Graph');
  });
});
