import { describe, expect, it } from 'bun:test';
import type { UsageEvent } from '../types';
import { clusterPrompts, tokenBigrams } from './prompt-clusters';

function makeEvent(overrides: Partial<UsageEvent> & { prompt: string }): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: '2026-04-01T10:00:00.000Z',
    date: '2026-04-01',
    model: 'claude-sonnet-4',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 150,
    cost: 0.01,
    ...overrides,
  };
}

describe('tokenBigrams', () => {
  it('emits unigrams and adjacent bigrams', () => {
    const shingles = tokenBigrams('how center div');
    expect(shingles.has('how')).toBe(true);
    expect(shingles.has('center')).toBe(true);
    expect(shingles.has('div')).toBe(true);
    expect(shingles.has('how\u0001center')).toBe(true);
    expect(shingles.has('center\u0001div')).toBe(true);
    expect(shingles.size).toBe(5);
  });

  it('handles single-token prompts (unigram only)', () => {
    const shingles = tokenBigrams('refactor');
    expect(shingles.size).toBe(1);
    expect(shingles.has('refactor')).toBe(true);
  });

  it('returns empty set for empty / tiny input', () => {
    expect(tokenBigrams('').size).toBe(0);
    expect(tokenBigrams('a an it').size).toBe(0);
    expect(tokenBigrams('   ').size).toBe(0);
  });

  it('lowercases and strips punctuation', () => {
    const a = tokenBigrams('Fix the Bug!!!');
    const b = tokenBigrams('fix the bug');
    expect(a).toEqual(b);
  });
});

describe('clusterPrompts', () => {
  it('returns empty array when no events have prompts', () => {
    const events: UsageEvent[] = [
      makeEvent({ prompt: '' }),
      { ...makeEvent({ prompt: 'placeholder' }), prompt: undefined },
    ];
    expect(clusterPrompts(events)).toEqual([]);
  });

  it('clusters near-duplicate prompts together', () => {
    const events = [
      makeEvent({ prompt: 'how to center a div', cost: 0.05 }),
      makeEvent({ prompt: 'how do I center a div?', cost: 0.03 }),
      makeEvent({ prompt: 'center a div horizontally', cost: 0.02 }),
    ];
    const clusters = clusterPrompts(events, { similarityThreshold: 0.3 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(3);
    expect(clusters[0]!.totalCost).toBeCloseTo(0.1, 10);
  });

  it('keeps distinct prompts in separate clusters', () => {
    const events = [
      makeEvent({ prompt: 'how to center a div', cost: 0.05 }),
      makeEvent({ prompt: 'write a graphql resolver for users', cost: 0.10 }),
    ];
    const clusters = clusterPrompts(events);
    expect(clusters).toHaveLength(2);
  });

  it('picks the highest-cost prompt as the canonical representative', () => {
    const events = [
      makeEvent({ prompt: 'fix lint error', cost: 0.01 }),
      makeEvent({ prompt: 'fix the lint error', cost: 0.08 }),
    ];
    const clusters = clusterPrompts(events, { similarityThreshold: 0.3 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.canonicalPrompt).toBe('fix the lint error');
    expect(clusters[0]!.count).toBe(2);
  });

  it('sorts clusters by total cost descending', () => {
    const events = [
      makeEvent({ prompt: 'alpha topic one two', cost: 0.01 }),
      makeEvent({ prompt: 'beta subject three four', cost: 0.50 }),
      makeEvent({ prompt: 'gamma theme five six', cost: 0.20 }),
    ];
    const clusters = clusterPrompts(events);
    expect(clusters.map((c) => c.canonicalPrompt)).toEqual([
      'beta subject three four',
      'gamma theme five six',
      'alpha topic one two',
    ]);
  });

  it('keeps prompts that normalize to empty as singleton clusters so their cost is counted', () => {
    const events = [
      makeEvent({ prompt: '!!!???', cost: 0.01 }),
      makeEvent({ prompt: 'go', cost: 0.02 }),
      makeEvent({ prompt: 'real prompt content here', cost: 0.05 }),
    ];
    const clusters = clusterPrompts(events);
    expect(clusters).toHaveLength(3);
    const totalCost = clusters.reduce((sum, c) => sum + c.totalCost, 0);
    expect(totalCost).toBeCloseTo(0.08, 10);
  });

  it('emits up to three sample prompts per cluster, ranked by cost descending', () => {
    const events = [
      makeEvent({ prompt: 'fix the lint error please', cost: 0.30 }),
      makeEvent({ prompt: 'please fix the lint error', cost: 0.20 }),
      makeEvent({ prompt: 'fix the lint error now', cost: 0.10 }),
      makeEvent({ prompt: 'fix the lint error quickly', cost: 0.05 }),
      makeEvent({ prompt: 'fix the lint error thanks', cost: 0.02 }),
    ];
    const clusters = clusterPrompts(events, { similarityThreshold: 0.3 });
    expect(clusters).toHaveLength(1);
    const samples = clusters[0]!.samplePrompts;
    expect(samples.length).toBeLessThanOrEqual(3);
    expect(samples[0]).toBe('fix the lint error please');
    expect(samples[1]).toBe('please fix the lint error');
    expect(samples[2]).toBe('fix the lint error now');
  });

  it('truncates sample prompts longer than the cap and collapses whitespace', () => {
    const long = 'refactor the huge module '.repeat(10);
    const events = [makeEvent({ prompt: `  ${long}\n\n`, cost: 0.1 })];
    const clusters = clusterPrompts(events);
    const sample = clusters[0]!.samplePrompts[0]!;
    expect(sample.length).toBeLessThanOrEqual(120);
    expect(sample).not.toContain('\n');
    expect(sample.endsWith('…')).toBe(true);
  });

  it('dedupes identical sample prompts within a cluster', () => {
    const events = [
      makeEvent({ prompt: 'fix lint', cost: 0.10 }),
      makeEvent({ prompt: 'fix lint', cost: 0.05 }),
      makeEvent({ prompt: 'fix lint again', cost: 0.02 }),
    ];
    const clusters = clusterPrompts(events, { similarityThreshold: 0.3 });
    const samples = clusters[0]!.samplePrompts;
    expect(new Set(samples).size).toBe(samples.length);
  });

  it('does not let duplicate high-cost prompts crowd out unique lower-cost samples', () => {
    // Two duplicates of the top prompt, then two distinct lower-cost prompts.
    // Before dedup-in-insert, the cap of 3 was filled by "fix lint" twice plus
    // "fix lint again", leaving "fix lint later" invisible.
    const events = [
      makeEvent({ prompt: 'fix lint', cost: 0.10 }),
      makeEvent({ prompt: 'fix lint', cost: 0.09 }),
      makeEvent({ prompt: 'fix lint again', cost: 0.08 }),
      makeEvent({ prompt: 'fix lint later', cost: 0.07 }),
    ];
    const clusters = clusterPrompts(events, { similarityThreshold: 0.3 });
    const samples = clusters[0]!.samplePrompts;
    expect(samples).toHaveLength(3);
    expect(samples).toContain('fix lint');
    expect(samples).toContain('fix lint again');
    expect(samples).toContain('fix lint later');
  });

  it('skips events with whitespace-only prompts', () => {
    const events = [
      makeEvent({ prompt: '   ', cost: 0.01 }),
      makeEvent({ prompt: 'real prompt content here', cost: 0.05 }),
    ];
    const clusters = clusterPrompts(events);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.canonicalPrompt).toBe('real prompt content here');
  });

  it('respects a custom similarity threshold', () => {
    const events = [
      makeEvent({ prompt: 'refactor this function', cost: 0.01 }),
      makeEvent({ prompt: 'refactor that method', cost: 0.01 }),
    ];
    // High threshold → separate clusters
    const strict = clusterPrompts(events, { similarityThreshold: 0.95 });
    expect(strict.length).toBe(2);
    // Low threshold → merged
    const loose = clusterPrompts(events, { similarityThreshold: 0.05 });
    expect(loose.length).toBe(1);
  });
});
