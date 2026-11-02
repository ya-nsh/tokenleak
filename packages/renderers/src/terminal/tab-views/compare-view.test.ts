import { describe, expect, it } from 'bun:test';
import {
  createOutput,
  createMoreStats,
  createPopulatedStats,
} from '../../__test-fixtures__';
import { renderCompareView } from './compare-view';

describe('renderCompareView', () => {
  it('renders compare metrics and model mix shift', () => {
    const output = createOutput({
      more: createMoreStats({
        compare: {
          previousRange: { since: '2025-12-01', until: '2025-12-31' },
          previousStats: createPopulatedStats({
            totalTokens: 70000,
            totalCost: 2.5,
            activeDays: 20,
            currentStreak: 3,
            averageDailyTokens: 1800,
            cacheHitRate: 0.28,
          }),
          deltas: {
            tokens: 30000,
            cost: 1.5,
            streak: 2,
            activeDays: 10,
            averageDailyTokens: 700,
            cacheHitRate: 0.14,
          },
          modelMixShift: [
            {
              model: 'claude-3-opus',
              currentShare: 0.5,
              previousShare: 0.34,
              deltaShare: 0.16,
              currentTokens: 50000,
              previousTokens: 24000,
            },
          ],
        },
      }),
    });
    const result = renderCompareView(output, 96, true);

    expect(result).toContain('Compare');
    expect(result).toContain('Model Mix Shift');
    expect(result).toContain('claude-3-opus');
    expect(result).toContain('Total Tokens');
  });

  it('shows an empty state without compare data', () => {
    const output = createOutput({ more: createMoreStats({ compare: null }) });
    const result = renderCompareView(output, 80, true);
    expect(result).toContain('No compare data available');
  });
});
