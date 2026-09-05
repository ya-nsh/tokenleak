import { expect, test } from 'bun:test';
import type { ProviderRegistry } from '@tokenleak/registry';
import { handleGetCostBreakdown } from './get-cost-breakdown';

test('returns every model so row costs reconcile with the overall total', async () => {
  const models = Array.from({ length: 11 }, (_, i) => ({ model: `model-${i}`, inputTokens: 100,
    outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100, cost: 1 }));
  const data = { provider: 'fixture', displayName: 'Fixture', totalTokens: 1100, totalCost: 11,
    daily: [{ date: '2026-03-12', inputTokens: 1100, outputTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, totalTokens: 1100, cost: 11, models }] };
  const registry = { getAvailable: async () => [{ name: 'fixture', load: async () => data }] } as unknown as ProviderRegistry;
  const result = await handleGetCostBreakdown({ since: '2026-03-12', until: '2026-03-12' }, registry);
  const body = JSON.parse(result.content[0]!.text);
  expect(body.models).toHaveLength(11);
  expect(body.models.reduce((sum: number, model: { cost: number }) => sum + model.cost, 0)).toBe(body.totalCost);
});
