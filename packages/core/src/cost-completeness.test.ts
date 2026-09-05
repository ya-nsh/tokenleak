import { describe, expect, test } from 'bun:test';
import { buildDailyCostCompleteness, buildEventCostCompleteness, combineCostCompleteness, mergeCostCompleteness } from './cost-completeness';
import type { DailyUsage, UsageEvent, ProviderData } from './types';

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


test('combining overflow completeness retains known cost-only contributions', () => {
  const event: UsageEvent = { provider: 'crush', date: '2026-04-26', timestamp: '2026-04-26T10:00:00Z',
    model: 'session-total', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    totalTokens: 0, cost: 25, costSource: 'provider-reported' };
  const known = buildEventCostCompleteness([event]);
  const unknown = buildEventCostCompleteness([{ ...event, model: 'unknown', totalTokens: 100, inputTokens: 100, cost: 0, costSource: 'unpriced' }]);
  expect(known.status).toBe('complete');
  expect(unknown.status).toBe('unknown');
  expect(combineCostCompleteness([known, unknown]).status).toBe('partial');
  const daily = buildDailyCostCompleteness([makeDaily({ totalTokens: 0, cost: 25 })]);
  expect(combineCostCompleteness([daily, unknown]).status).toBe('partial');
  expect(mergeCostCompleteness([
    { totalTokens: 0, totalCost: 25, daily: [], costCompleteness: known },
    { totalTokens: 100, totalCost: 0, daily: [], costCompleteness: unknown },
  ] as ProviderData[]).status).toBe('partial');
});
