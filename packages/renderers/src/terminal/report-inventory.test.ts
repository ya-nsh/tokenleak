import { expect, test } from 'bun:test';
import { aggregate } from '@tokenleak/core';
import { createOutput, createProvider, createRenderOptions } from '../__test-fixtures__';
import { TerminalRenderer } from './terminal-renderer';
import { generateWrappedLiveHtml } from '../live/wrapped-live-template';
import { computeAchievements } from '../svg/wrapped-slides';

test('cost-only providers remain visible when token counts are unavailable', async () => {
  const provider = { ...createProvider('crush', 'Crush'), totalTokens: 0, totalCost: 25,
    daily: [{ date: '2026-03-12', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
      totalTokens: 0, cost: 25, models: [] }] };
  const output = createOutput({ providers: [provider], dateRange: { since: '2026-03-12', until: '2026-03-12' } });
  const rendered = await new TerminalRenderer().render(
    output,
    createRenderOptions({ format: 'terminal', width: 100, noColor: true }),
  );
  expect(rendered).toContain('Crush');
  expect(rendered).toContain('$25.00');
  expect(rendered).not.toContain('No provider activity');
});

test('providers with neither tokens nor cost stay in the inactive list', async () => {
  const provider = { ...createProvider('crush', 'Crush'), totalTokens: 0, totalCost: 0, daily: [] };
  const output = createOutput({ providers: [provider], dateRange: { since: '2026-03-12', until: '2026-03-12' } });
  const rendered = await new TerminalRenderer().render(
    output,
    createRenderOptions({ format: 'terminal', width: 100, noColor: true }),
  );
  expect(rendered).toContain('No provider activity');
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

test('model shares never claim 0% or 100% while other models exist', async () => {
  const { formatSharePercent } = await import('./dashboard-model');
  expect(formatSharePercent(0)).toBe('0%');
  expect(formatSharePercent(0.2)).toBe('<1%');
  expect(formatSharePercent(0.5)).toBe('1%');
  expect(formatSharePercent(42.4)).toBe('42%');
  expect(formatSharePercent(99.7)).toBe('>99%');
  expect(formatSharePercent(100)).toBe('100%');
});
