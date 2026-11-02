import { expect, test } from 'bun:test';
import { aggregate } from '@tokenleak/core';
import { createOutput } from '../__test-fixtures__';
import { generateWrappedLiveHtml } from '../live/wrapped-live-template';
import { computeAchievements } from '../svg/wrapped-slides';

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
