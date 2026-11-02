import { describe, expect, test } from 'bun:test';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, findUnknownFlag, knownFlagsFor, suggestFlag } from './flag-validation';

const ARGS: ArgsDef = {
  days: { type: 'string', alias: 'd' },
  noColor: { type: 'boolean' },
  allProviders: { type: 'boolean' },
  provider: { type: 'string', alias: ['p'] },
  date: { type: 'positional' },
};

describe('knownFlagsFor', () => {
  test('includes camelCase, kebab-case, negations, aliases, help, and version', () => {
    const known = knownFlagsFor(ARGS);
    for (const flag of ['--days', '-d', '--noColor', '--no-color', '--all-providers', '--no-all-providers', '-p', '--help', '-v']) {
      expect(known.has(flag)).toBe(true);
    }
    expect(known.has('--date')).toBe(false);
  });
});

describe('findUnknownFlag', () => {
  const known = knownFlagsFor(ARGS);

  test('returns nothing when every flag is known', () => {
    expect(findUnknownFlag(['--days', '30', '-p', 'claude', '2026-01-01'], known)).toBeUndefined();
  });

  test('handles --flag=value', () => {
    expect(findUnknownFlag(['--days=30'], known)).toBeUndefined();
    expect(findUnknownFlag(['--dayz=30'], known)).toBe('--dayz');
  });

  test('treats negative numbers as values, not flags', () => {
    expect(findUnknownFlag(['--days', '-5'], known)).toBeUndefined();
  });

  test('stops at --', () => {
    expect(findUnknownFlag(['--', '--anything'], known)).toBeUndefined();
  });

  test('empty argv has no unknown flags', () => {
    expect(findUnknownFlag([], known)).toBeUndefined();
  });
});

describe('suggestFlag', () => {
  const known = knownFlagsFor(ARGS);

  test('suggests the documented kebab spelling for a near miss', () => {
    expect(suggestFlag('--day', known)).toBe('--days');
    expect(suggestFlag('--no-colour', known)).toBe('--no-color');
  });

  test('suggests nothing for an unrelated flag', () => {
    expect(suggestFlag('--frobnicate', known)).toBeUndefined();
  });
});

describe('assertKnownFlags', () => {
  test('passes for known flags', () => {
    expect(() => assertKnownFlags(['--days', '7'], ARGS, 'tokenleak')).not.toThrow();
  });

  test('throws with suggestion and usage for unknown flags', () => {
    expect(() => assertKnownFlags(['--day', '7'], ARGS, 'tokenleak')).toThrow(
      'Unknown flag "--day" for `tokenleak`. Did you mean "--days"?\nUsage: tokenleak [flags]',
    );
  });
});
