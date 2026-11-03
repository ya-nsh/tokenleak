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

describe('clusterPrompts repeated turns', () => {
  const base = {
    provider: 'claude-code',
    date: '2026-05-01',
    model: 'claude-opus-5-5',
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2,
    cost: 1,
    sessionId: 's1',
  };

  it('every assistant message of one turn lands in the same cluster as one prompt', () => {
    const prompt = 'refactor the billing module and add tests for the edge cases';
    const events = Array.from({ length: 50 }, (_, i) => ({
      ...base,
      timestamp: `2026-05-01T10:${String(i).padStart(2, '0')}:00.000Z`,
      prompt,
      promptId: 'user:1',
    }));
    const clusters = clusterPrompts(events);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(1);
    expect(clusters[0]!.totalCost).toBe(50);
  });

  it('identical prompt text in different turns clusters together', () => {
    const prompt = 'run the full test suite and fix any failures you find';
    const events = ['user:1', 'user:2', 'user:3'].map((promptId, i) => ({
      ...base,
      timestamp: `2026-05-01T1${i}:00:00.000Z`,
      prompt,
      promptId,
    }));
    const clusters = clusterPrompts(events);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(3);
  });
});

describe('clusterPrompts candidate index', () => {
  it('breaks similarity ties toward the earliest cluster', () => {
    const clusters = clusterPrompts(
      [
        makeEvent({ prompt: 'alpha beta gamma', cost: 1 }),
        makeEvent({ prompt: 'delta epsilon zeta', cost: 1 }),
        // Shares three shingles with each earlier prompt: Jaccard 3/9 against both.
        makeEvent({ prompt: 'alpha beta delta epsilon', cost: 0.5 }),
      ],
      { similarityThreshold: 0.1 },
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.canonicalPrompt).toBe('alpha beta gamma');
    expect(clusters[0]!.count).toBe(2);
    expect(clusters[1]!.count).toBe(1);
  });

  it('matches prompts against shingles a cluster gained from later members', () => {
    const clusters = clusterPrompts(
      [
        makeEvent({ prompt: 'alpha beta gamma delta', cost: 3 }),
        makeEvent({ prompt: 'alpha beta gamma omega', cost: 2 }),
        // Jaccard 1/11 against the first prompt alone, 3/11 once "omega" joined.
        makeEvent({ prompt: 'gamma omega theta', cost: 1 }),
      ],
      { similarityThreshold: 0.2 },
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(3);
  });

  it('merges prompts with no shared shingles when the threshold is zero', () => {
    const clusters = clusterPrompts(
      [makeEvent({ prompt: 'alpha beta' }), makeEvent({ prompt: 'gamma delta' })],
      { similarityThreshold: 0 },
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(2);
  });

  it('keeps turns with and without a session id apart', () => {
    const clusters = clusterPrompts(
      [
        makeEvent({ prompt: 'alpha beta gamma', promptId: 'p1', sessionId: '' }),
        makeEvent({ prompt: 'alpha beta gamma', promptId: 'p1' }),
      ],
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.count).toBe(2);
  });

  it('partitions prompts exactly like a scan over every cluster', () => {
    const vocabulary = ['fix', 'lint', 'test', 'build', 'deploy', 'refactor', 'billing', 'auth', 'cache', 'docs'];
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const prompts = Array.from({ length: 40 }, (_, i) => {
      const words = Array.from({ length: 2 + Math.floor(random() * 4) }, () =>
        vocabulary[Math.floor(random() * vocabulary.length)]!,
      );
      return `${words.join(' ')} step${i}`;
    });

    for (const threshold of [0.1, 0.2, 0.3]) {
      // Reference: scan every cluster, keep the first strictly-best match.
      const reference: { signature: Set<string>; members: number[] }[] = [];
      prompts.forEach((prompt, i) => {
        const signature = tokenBigrams(prompt);
        let best: { cluster: (typeof reference)[number]; sim: number } | null = null;
        for (const cluster of reference) {
          let shared = 0;
          for (const shingle of signature) if (cluster.signature.has(shingle)) shared++;
          const sim = shared / (signature.size + cluster.signature.size - shared);
          if (sim >= threshold && (best === null || sim > best.sim)) best = { cluster, sim };
        }
        if (best) {
          best.cluster.members.push(i);
          for (const shingle of signature) best.cluster.signature.add(shingle);
        } else {
          reference.push({ signature, members: [i] });
        }
      });

      // Cost 2^i makes each cluster's total cost an exact bitmask of its members.
      const events = prompts.map((prompt, i) => makeEvent({ prompt, cost: 2 ** i }));
      const actual = clusterPrompts(events, { similarityThreshold: threshold })
        .map((cluster) => cluster.totalCost)
        .sort((a, b) => a - b);
      const expected = reference
        .map((cluster) => cluster.members.reduce((sum, i) => sum + 2 ** i, 0))
        .sort((a, b) => a - b);
      expect(actual).toEqual(expected);
    }
  });
});
