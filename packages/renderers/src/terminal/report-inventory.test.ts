import { expect, test } from 'bun:test';
import { aggregate } from '@tokenleak/core';
import { createOutput, createProvider } from '../__test-fixtures__';
import { renderProviderView } from './tab-views/provider-view';
import { generateWrappedLiveHtml } from '../live/wrapped-live-template';
import { computeAchievements } from '../svg/wrapped-slides';

test('cost-only providers remain visible when token counts are unavailable', () => {
  const provider = { ...createProvider('crush', 'Crush'), totalTokens: 0, totalCost: 25,
    daily: [{ date: '2026-03-12', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      totalTokens: 0, cost: 25, models: [] }] };
  const output = createOutput({ providers: [provider], dateRange: { since: '2026-03-12', until: '2026-03-12' } });
  const rendered = renderProviderView(output, 100, true);
  expect(rendered).toContain('Crush'); expect(rendered).toContain('$25.00');
  expect(rendered).not.toContain('No provider activity');
});

test('Wrapped counts the full inventory even when the ranking shows ten models', () => {
  const models = Array.from({ length: 11 }, (_, index) => ({ model: `model-${index}`, inputTokens: 100,
    outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100, cost: 1 }));
  const stats = aggregate([{ date: '2026-03-12', inputTokens: 1100, outputTokens: 0, cacheReadTokens: 0,
    cacheWriteTokens: 0, totalTokens: 1100, cost: 11, models }], '2026-03-12');
  const output = createOutput({ aggregated: stats });
  expect(stats.topModels).toHaveLength(10);
  expect(generateWrappedLiveHtml(output)).toContain('11 models');
  expect(computeAchievements(output).some((achievement) => achievement.subtitle === '11 models used')).toBe(true);
});
