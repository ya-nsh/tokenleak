import { describe, expect, it } from 'bun:test';
import { mergeProviderData } from './merge';
import type { DailyUsage, ModelBreakdown, ProviderData } from '../types';

function makeModel(model: string, tokens: number): ModelBreakdown {
  return {
    model,
    inputTokens: Math.floor(tokens * 0.6),
    outputTokens: Math.floor(tokens * 0.4),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: tokens,
    cost: tokens * 0.001,
  };
}

function makeDaily(date: string, models: ModelBreakdown[]): DailyUsage {
  return {
    date,
    inputTokens: models.reduce((s, m) => s + m.inputTokens, 0),
    outputTokens: models.reduce((s, m) => s + m.outputTokens, 0),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: models.reduce((s, m) => s + m.totalTokens, 0),
    cost: models.reduce((s, m) => s + m.cost, 0),
    models,
  };
}

function makeProvider(
  name: string,
  daily: DailyUsage[],
): ProviderData {
  return {
    provider: name,
    displayName: name,
    daily,
    totalTokens: daily.reduce((s, d) => s + d.totalTokens, 0),
    totalCost: daily.reduce((s, d) => s + d.cost, 0),
    colors: { primary: '#000', secondary: '#fff', gradient: ['#000', '#fff'] },
  };
}

describe('mergeProviderData', () => {
  it('returns empty array for no providers', () => {
    const result = mergeProviderData([]);
    expect(result).toEqual([]);
  });

  it('returns data unchanged for a single provider', () => {
    const daily = [makeDaily('2026-01-01', [makeModel('opus', 1000)])];
    const result = mergeProviderData([makeProvider('a', daily)]);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-01-01');
    expect(result[0].models).toHaveLength(1);
  });

  it('merges same date from different providers by summing tokens', () => {
    const p1 = makeProvider('a', [
      makeDaily('2026-01-01', [makeModel('opus', 1000)]),
    ]);
    const p2 = makeProvider('b', [
      makeDaily('2026-01-01', [makeModel('sonnet', 2000)]),
    ]);
    const result = mergeProviderData([p1, p2]);

    expect(result).toHaveLength(1);
    expect(result[0].totalTokens).toBe(3000);
  });

  it('aggregates same model from different providers instead of duplicating', () => {
    const p1 = makeProvider('a', [
      makeDaily('2026-01-01', [makeModel('opus', 1000)]),
    ]);
    const p2 = makeProvider('b', [
      makeDaily('2026-01-01', [makeModel('opus', 500)]),
    ]);
    const result = mergeProviderData([p1, p2]);

    // Should have 1 merged model entry, not 2 duplicates
    expect(result[0].models).toHaveLength(1);
    expect(result[0].models[0].model).toBe('opus');
    expect(result[0].models[0].totalTokens).toBe(1500);
  });

  it('keeps distinct models separate when merging same date', () => {
    const p1 = makeProvider('a', [
      makeDaily('2026-01-01', [makeModel('opus', 1000)]),
    ]);
    const p2 = makeProvider('b', [
      makeDaily('2026-01-01', [makeModel('sonnet', 2000)]),
    ]);
    const result = mergeProviderData([p1, p2]);

    expect(result[0].models).toHaveLength(2);
    const modelNames = result[0].models.map((m) => m.model).sort();
    expect(modelNames).toEqual(['opus', 'sonnet']);
  });

  it('sorts output by date ascending', () => {
    const p1 = makeProvider('a', [
      makeDaily('2026-01-03', [makeModel('opus', 100)]),
      makeDaily('2026-01-01', [makeModel('opus', 300)]),
    ]);
    const p2 = makeProvider('b', [
      makeDaily('2026-01-02', [makeModel('opus', 200)]),
    ]);
    const result = mergeProviderData([p1, p2]);

    expect(result.map((d) => d.date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
  });

  it('handles three providers with overlapping dates and models', () => {
    const p1 = makeProvider('a', [
      makeDaily('2026-01-01', [makeModel('opus', 1000), makeModel('sonnet', 500)]),
    ]);
    const p2 = makeProvider('b', [
      makeDaily('2026-01-01', [makeModel('opus', 200)]),
    ]);
    const p3 = makeProvider('c', [
      makeDaily('2026-01-01', [makeModel('haiku', 300)]),
    ]);
    const result = mergeProviderData([p1, p2, p3]);

    expect(result).toHaveLength(1);
    expect(result[0].models).toHaveLength(3); // opus, sonnet, haiku
    const opus = result[0].models.find((m) => m.model === 'opus');
    expect(opus?.totalTokens).toBe(1200);
  });
});
