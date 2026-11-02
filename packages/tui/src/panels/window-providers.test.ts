import { describe, expect, test } from 'bun:test';
import type { ProviderData } from '@tokenleak/core';
import { windowProviderTotals } from './bloomberg';

function provider(name: string, days: Array<[string, number, number]>): ProviderData {
  return {
    provider: name,
    displayName: name,
    totalTokens: days.reduce((sum, [, tokens]) => sum + tokens, 0),
    totalCost: days.reduce((sum, [, , cost]) => sum + cost, 0),
    colors: { primary: '#000', secondary: '#000', gradient: ['#000', '#000'] },
    daily: days.map(([date, totalTokens, cost]) => ({
      date,
      inputTokens: totalTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens,
      cost,
      models: [],
    })),
  };
}

describe('windowProviderTotals', () => {
  const providers = [
    provider('claude', [['2026-11-01', 100, 1], ['2026-10-01', 50, 1]]),
    provider('codex', [['2026-10-01', 10, 0.1]]),
    provider('idle', []),
    provider('crush', [['2026-11-02', 0, 25]]),
  ];

  test('counts only providers active inside the window', () => {
    const totals = windowProviderTotals(providers, 7, '2026-11-03');
    expect(totals.map((p) => p.provider)).toEqual(['claude', 'crush']);
    expect(totals[0]!.windowTokens).toBe(100);
  });

  test('all-time windows include every active provider', () => {
    expect(windowProviderTotals(providers, 0, '2026-11-03').map((p) => p.provider)).toEqual(['claude', 'codex', 'crush']);
  });

  test('the window edge is inclusive', () => {
    expect(windowProviderTotals(providers, 34, '2026-11-03').map((p) => p.provider)).toContain('codex');
    expect(windowProviderTotals(providers, 33, '2026-11-03').map((p) => p.provider)).not.toContain('codex');
  });

  test('costs carry completeness', () => {
    const [claude] = windowProviderTotals(providers, 7, '2026-11-03');
    expect(claude!.windowCompleteness.status).toBeDefined();
  });
});
