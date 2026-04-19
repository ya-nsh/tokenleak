import { describe, expect, it } from 'bun:test';
import type { DateRange, UsageEvent } from '../types';
import { buildReceipt } from './receipt-lines';

const RANGE: DateRange = { since: '2026-04-01', until: '2026-04-30' };

function makeEvent(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: '2026-04-10T10:00:00.000Z',
    date: '2026-04-10',
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

describe('buildReceipt', () => {
  it('returns an empty receipt for an empty event list', () => {
    const receipt = buildReceipt([], RANGE);
    expect(receipt.lines).toEqual([]);
    expect(receipt.summary.total).toBe(0);
    expect(receipt.summary.subtotal).toBe(0);
    expect(receipt.summary.serviceFees).toBe(0);
    expect(receipt.summary.accountedPrompts).toBe(0);
    expect(receipt.summary.unlabeledEvents).toBe(0);
  });

  it('produces one line per unique prompt cluster', () => {
    const events = [
      makeEvent({ prompt: 'center a div horizontally', cost: 0.05 }),
      makeEvent({ prompt: 'write a graphql resolver', cost: 0.08 }),
    ];
    const receipt = buildReceipt(events, RANGE);
    expect(receipt.lines).toHaveLength(2);
  });

  it('classifies prompts into expected categories', () => {
    const events = [
      makeEvent({ prompt: 'fix this error in my code', cost: 0.05 }),
      makeEvent({ prompt: 'center a div horizontally', cost: 0.04 }),
      makeEvent({ prompt: 'explain what this function does', cost: 0.03 }),
      makeEvent({ prompt: 'refactor this to use a map', cost: 0.02 }),
      makeEvent({ prompt: 'write a test for the new feature', cost: 0.01 }),
      makeEvent({ prompt: 'implement a new feature for users', cost: 0.06 }),
      makeEvent({ prompt: 'should I use useEffect or useMemo', cost: 0.02 }),
      makeEvent({ prompt: 'typo on line 3', cost: 0.01 }),
      makeEvent({ prompt: 'quantum flux capacitor handling', cost: 0.005 }),
    ];
    const receipt = buildReceipt(events, RANGE);

    const categories = receipt.lines.map((l) => l.category);
    expect(categories).toContain('debugging');
    expect(categories).toContain('styling');
    expect(categories).toContain('explain-again');
    expect(categories).toContain('refactoring');
    expect(categories).toContain('testing');
    expect(categories).toContain('new-code');
    expect(categories).toContain('opinion');
    expect(categories).toContain('typo');
    expect(categories).toContain('misc');
  });

  it('sums line totals into subtotal and tracks unlabeled events as service fees', () => {
    const events = [
      makeEvent({ prompt: 'center a div horizontally', cost: 0.05 }),
      makeEvent({ prompt: 'write a graphql resolver', cost: 0.10 }),
      makeEvent({ cost: 0.03 }), // no prompt captured
      makeEvent({ cost: 0.02 }), // no prompt captured
    ];
    const receipt = buildReceipt(events, RANGE);
    expect(receipt.summary.subtotal).toBeCloseTo(0.15, 10);
    expect(receipt.summary.serviceFees).toBeCloseTo(0.05, 10);
    expect(receipt.summary.total).toBeCloseTo(0.20, 10);
    expect(receipt.summary.accountedPrompts).toBe(2);
    expect(receipt.summary.unlabeledEvents).toBe(2);
  });

  it('caps the number of lines to topLines', () => {
    const distinctPrompts = [
      'center a div horizontally',
      'write a graphql resolver for users',
      'refactor the auth middleware',
      'explain javascript closures',
      'fix memory leak in worker',
      'implement binary search tree',
      'typo on line 42',
      'which database should I choose',
      'add unit test for parser',
      'styling navbar with tailwind flex',
    ];
    const events = distinctPrompts.map((p) => makeEvent({ prompt: p, cost: 0.01 }));
    const receipt = buildReceipt(events, RANGE, { topLines: 5 });
    expect(receipt.lines).toHaveLength(5);
  });

  it('emits samplePrompts on every line item and the overflow line', () => {
    const distinctPrompts = [
      'fix the lint error please',
      'center a div horizontally please',
      'refactor the auth middleware gently',
      'explain javascript closures to me',
      'implement a binary search tree',
      'write a unit test for the parser',
    ];
    const events = distinctPrompts.map((p, i) => makeEvent({ prompt: p, cost: 0.10 - i * 0.01 }));
    const receipt = buildReceipt(events, RANGE, { topLines: 3 });

    // All line items should carry samplePrompts.
    for (const line of receipt.lines) {
      expect(Array.isArray(line.samplePrompts)).toBe(true);
    }

    // Overflow line should preview the clusters that were cut.
    const overflow = receipt.lines.find((l) => l.description.startsWith('Other prompt clusters'));
    expect(overflow).toBeDefined();
    expect(overflow!.samplePrompts.length).toBeGreaterThan(0);
    expect(overflow!.samplePrompts.length).toBeLessThanOrEqual(3);
  });

  it('sorts lines by cost descending', () => {
    const events = [
      makeEvent({ prompt: 'cheap prompt alpha', cost: 0.01 }),
      makeEvent({ prompt: 'expensive prompt beta', cost: 0.20 }),
      makeEvent({ prompt: 'medium prompt gamma', cost: 0.05 }),
    ];
    const receipt = buildReceipt(events, RANGE);
    const costs = receipt.lines.map((l) => l.totalCost);
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]!).toBeLessThanOrEqual(costs[i - 1]!);
    }
  });

  it('collapses repeated prompts into one quantity', () => {
    const events = [
      makeEvent({ prompt: 'fix the lint error again', cost: 0.01 }),
      makeEvent({ prompt: 'please fix the lint error', cost: 0.01 }),
      makeEvent({ prompt: 'fix lint error', cost: 0.01 }),
    ];
    const receipt = buildReceipt(events, RANGE, { similarityThreshold: 0.3 });
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0]!.quantity).toBe(3);
    expect(receipt.lines[0]!.category).toBe('debugging');
  });

  it('truncates very long descriptions with an ellipsis', () => {
    const longPrompt = 'refactor the massive module '.repeat(20);
    const receipt = buildReceipt([makeEvent({ prompt: longPrompt })], RANGE);
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0]!.description.length).toBeLessThanOrEqual(80);
    expect(receipt.lines[0]!.description.endsWith('…')).toBe(true);
  });

  describe('classifier precedence', () => {
    function classify(prompt: string) {
      const receipt = buildReceipt([makeEvent({ prompt, cost: 0.01 })], RANGE);
      return receipt.lines[0]?.category;
    }

    it('typo beats debugging when both match', () => {
      // "fix the typo" contains both `fix` (debugging) and `typo`.
      expect(classify('fix the typo on line 3')).toBe('typo');
    });

    it('testing beats debugging for test-intent prompts', () => {
      // "test for the error handler" mentions `error` but the intent is testing.
      expect(classify('write a test for the error handler')).toBe('testing');
      expect(classify('add spec coverage for the failing flow')).toBe('testing');
    });

    it('testing beats new-code when a test is being authored', () => {
      expect(classify('write a test for the parser')).toBe('testing');
      expect(classify('create a mock for the auth middleware')).toBe('testing');
    });

    it('styling beats new-code when layout work is requested', () => {
      expect(classify('add padding to the navbar')).toBe('styling');
      expect(classify('implement a flex layout for the card')).toBe('styling');
    });

    it('explain-again beats debugging for explanation requests about bugs', () => {
      expect(classify('explain why this fails')).toBe('explain-again');
      expect(classify('what does this error mean')).toBe('explain-again');
    });

    it('refactoring beats debugging when the verb is refactor', () => {
      expect(classify('refactor this broken module')).toBe('refactoring');
      expect(classify('clean up the debug helper')).toBe('refactoring');
    });

    it('opinion beats everything when the user is asking for a recommendation', () => {
      expect(classify('which library should I use for testing')).toBe('opinion');
      expect(classify('what do you think is the best way to fix this')).toBe('opinion');
    });

    it('debugging still catches plain failure-oriented prompts', () => {
      expect(classify('fix the bug')).toBe('debugging');
      expect(classify('debug this crash')).toBe('debugging');
      expect(classify('stack trace shows segfault')).toBe('debugging');
    });

    it('falls back to misc when no pattern matches', () => {
      expect(classify('hello world')).toBe('misc');
      expect(classify('quantum flux capacitor handling')).toBe('misc');
    });
  });
});
