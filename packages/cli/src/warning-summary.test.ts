import { describe, expect, test } from 'bun:test';
import { describeWarningsVerbose, summarizeWarnings, type LabeledWarning } from './warning-summary';

const skip = (file: string, count: number, provider = 'Claude Code'): LabeledWarning => ({
  provider,
  warning: { kind: 'parse', file, count },
});
const unpriced = (model: string, count: number): LabeledWarning => ({
  provider: 'Codex',
  warning: { kind: 'unknown-pricing', file: model, count },
});

describe('summarizeWarnings', () => {
  test('no warnings, no lines', () => {
    expect(summarizeWarnings([])).toEqual([]);
  });

  test('collapses skipped entries across files into one line', () => {
    const lines = summarizeWarnings([skip('a.jsonl', 8), skip('b.jsonl', 21), skip('c.jsonl', 1, 'Codex')]);
    expect(lines).toEqual([
      'Note: skipped 30 unreadable log entries in 3 files (Claude Code, Codex); totals exclude them. Use --verbose for details.',
    ]);
  });

  test('uses singular wording for one entry in one file', () => {
    expect(summarizeWarnings([skip('a.jsonl', 1)])[0]).toContain('1 unreadable log entry in 1 file');
  });

  test('collapses unpriced models and points at tokenleak pricing', () => {
    const lines = summarizeWarnings([
      unpriced('m1', 3),
      unpriced('m2', 2),
      unpriced('m3', 1),
      unpriced('m4', 1),
    ]);
    expect(lines).toEqual([
      'Warning: 7 events use models with no known price (m1, m2, m3 +1 more); costs are incomplete. Run `tokenleak pricing` to fix.',
    ]);
  });

  test('keeps provider load failures, listed first', () => {
    const lines = summarizeWarnings([
      skip('a.jsonl', 2),
      { provider: 'Hermes', warning: { kind: 'provider-load', file: '', count: 1 } },
    ]);
    expect(lines[0]).toBe('Warning: Hermes failed to load; data from this provider is omitted.');
    expect(lines).toHaveLength(2);
  });

  test('a warning reported by two loads (compare mode) counts once', () => {
    const lines = summarizeWarnings([skip('a.jsonl', 5), skip('a.jsonl', 5)]);
    expect(lines[0]).toContain('5 unreadable log entries in 1 file');
  });
});

describe('describeWarningsVerbose', () => {
  test('one line per file', () => {
    expect(describeWarningsVerbose([skip('a.jsonl', 2), unpriced('m1', 1)])).toEqual([
      'Warning: Claude Code skipped 2 parse entries in a.jsonl',
      'Warning: Codex 1 event has no known price for model "m1"; cost totals are incomplete.',
    ]);
  });
});
