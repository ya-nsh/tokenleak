import { describe, expect, test } from 'bun:test';
import { aggregate, formatCostWithCompleteness } from '@tokenleak/core';
import { createInitialState } from '../lib/state';
import { createModelList } from './model-list';

function text(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const value = node as { props?: { content?: string }; children?: unknown[] };
  return (value.props?.content ?? '') + (value.children ?? []).map(text).join('');
}

describe('model browser', () => {
  test('sorts the entire inventory by cost and scrolls beyond the top ten', () => {
    const models = Array.from({ length: 11 }, (_, i) => ({ model: `model-${i}`, inputTokens: 11 - i,
      outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 11 - i, cost: i === 10 ? 100 : 1 }));
    const stats = aggregate([{ date: '2026-09-01', inputTokens: 66, outputTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, totalTokens: 66, cost: 110, models }], '2026-09-01');
    const state = createInitialState(); state.isLoading = false; state.sortMode = 'cost';
    expect(text(createModelList(state, stats))).toContain('model-10');
    state.sortMode = 'tokens'; state.modelScrollOffset = 1;
    expect(text(createModelList(state, stats))).toContain('model-10');
  });

  test('shows Fast and unknown cost rather than a free model', () => {
    const model = { model: 'gpt-5.5', inputTokens: 100, outputTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, totalTokens: 100, cost: 0, costSource: 'unpriced' as const,
      serviceTiers: [{ tier: 'fast', tokens: 100, cost: 0, unpricedTokens: 100 }] };
    const stats = aggregate([{ date: '2026-09-01', ...model, models: [model] }], '2026-09-01');
    const state = createInitialState(); state.isLoading = false;
    const rendered = text(createModelList(state, stats));
    expect(rendered).toContain('gpt-5.5 [Fast]');
    expect(rendered).toContain('Unknown');
    expect(rendered).not.toContain('$0.00');
    expect(formatCostWithCompleteness(0, { status: 'complete', totalTokens: 100, pricedTokens: 100,
      unpricedTokens: 0, unknownModels: [] })).toBe('$0.00');
  });
});
