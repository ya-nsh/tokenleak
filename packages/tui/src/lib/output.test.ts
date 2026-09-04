import { expect, test } from 'bun:test';
import { aggregate, type DailyUsage } from '@tokenleak/core';
import { buildTokenleakOutput, type TuiData } from './data';
import { createInitialState } from './state';

test('exports only the selected historical window and preserves ALL data', () => {
  const day = (date: string, cost: number): DailyUsage => ({ date, inputTokens: 100, outputTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100, cost, models: [] });
  const daily = [day('2026-03-11', 99), day('2026-03-12', 1)];
  const range = { since: '2026-03-12', until: '2026-03-12' };
  const allRange = { since: '2026-03-11', until: '2026-03-12' };
  const state = createInitialState(); state.selectedWindowIndex = 0;
  const selected = { dateRange: range, stats: aggregate([daily[1]!], range.until, range) };
  state.data = { dateRange: allRange, mergedDaily: daily,
    providers: [{ provider: 'fixture', displayName: 'Fixture', daily, totalTokens: 200, totalCost: 100 }],
    windows: [selected, selected, selected, selected, { dateRange: allRange, stats: aggregate(daily, allRange.until, allRange) }],
  } as unknown as TuiData;
  const output = buildTokenleakOutput(state)!;
  expect(output.dateRange).toEqual(range);
  expect(output.providers[0]!.daily).toHaveLength(1);
  expect(output.providers[0]!.totalCost).toBe(1);
  expect(output.aggregated.totalCost).toBe(1);
  expect(state.data.providers[0]!.totalCost).toBe(100);
  state.selectedWindowIndex = 4;
  expect(buildTokenleakOutput(state)!.providers[0]!.totalCost).toBe(100);
});
