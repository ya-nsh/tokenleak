import { describe, expect, test } from 'bun:test';
import { rankWrappedProviders } from './wrapped';

const p = (displayName: string, totalTokens: number, totalCost = 0) => ({ displayName, totalTokens, totalCost });

describe('rankWrappedProviders', () => {
  test('sorts by tokens and drops idle providers', () => {
    const ranked = rankWrappedProviders([p('Cursor', 0), p('Codex', 89), p('Hermes', 0), p('Claude Code', 2100)]);
    expect(ranked.map((x) => x.displayName)).toEqual(['Claude Code', 'Codex']);
  });

  test('keeps cost-only providers', () => {
    expect(rankWrappedProviders([p('Crush', 0, 25)]).map((x) => x.displayName)).toEqual(['Crush']);
  });

  test('breaks ties by cost, then name', () => {
    const ranked = rankWrappedProviders([p('B', 10, 1), p('A', 10, 1), p('C', 10, 2)]);
    expect(ranked.map((x) => x.displayName)).toEqual(['C', 'A', 'B']);
  });

  test('empty input stays empty and is not mutated', () => {
    const input = [p('Codex', 1), p('Claude', 2)];
    rankWrappedProviders(input);
    expect(input[0]!.displayName).toBe('Codex');
    expect(rankWrappedProviders([])).toEqual([]);
  });
});
