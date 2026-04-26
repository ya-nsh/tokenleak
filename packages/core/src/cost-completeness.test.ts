import { describe, expect, test } from 'bun:test';
import { buildDailyCostCompleteness } from './cost-completeness';
import type { DailyUsage } from './types';

function makeDaily(overrides: Partial<DailyUsage> = {}): DailyUsage {
  return {
    date: '2026-04-26',
    inputTokens: 100,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 200,
    cost: 0.02,
    models: [],
    ...overrides,
  };
}

describe('buildDailyCostCompleteness', () => {
  test('treats legacy rows with cost but no model breakdown as priced', () => {
    expect(buildDailyCostCompleteness([makeDaily()])).toEqual({
      status: 'complete',
      totalTokens: 200,
      pricedTokens: 200,
      unpricedTokens: 0,
      unknownModels: [],
    });
  });

  test('treats token rows with no cost and no model breakdown as unknown', () => {
    expect(buildDailyCostCompleteness([makeDaily({ cost: 0 })])).toEqual({
      status: 'unknown',
      totalTokens: 200,
      pricedTokens: 0,
      unpricedTokens: 200,
      unknownModels: [],
    });
  });

  test('returns complete completeness for truly empty data', () => {
    expect(buildDailyCostCompleteness([])).toEqual({
      status: 'complete',
      totalTokens: 0,
      pricedTokens: 0,
      unpricedTokens: 0,
      unknownModels: [],
    });
  });
});
