import { describe, expect, test } from 'bun:test';
import { resolveUsageCost } from './costing';

describe('resolveUsageCost', () => {
  test('uses non-negative provider-reported costs directly', () => {
    expect(
      resolveUsageCost({
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        explicitCost: 1.23,
      }),
    ).toMatchObject({
      cost: 1.23,
      costSource: 'provider-reported',
      pricedTokens: 2000,
      unpricedTokens: 0,
    });
  });

  test('ignores negative provider-reported costs and falls back to estimated pricing', () => {
    expect(
      resolveUsageCost({
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        explicitCost: -12.34,
      }),
    ).toMatchObject({
      cost: 0.0125,
      costSource: 'estimated',
      pricedTokens: 2000,
      unpricedTokens: 0,
    });
  });
});
