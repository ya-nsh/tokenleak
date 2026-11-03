import { describe, expect, it } from 'bun:test';
import { DOWNGRADE_PATHS, getDowngradePath } from './downgrade-paths';

describe('DOWNGRADE_PATHS', () => {
  it('maps opus models to sonnet alternatives', () => {
    expect(DOWNGRADE_PATHS['claude-opus-4']).toBe('claude-sonnet-4');
    expect(DOWNGRADE_PATHS['claude-opus-4-6']).toBe('claude-sonnet-4-6');
    expect(DOWNGRADE_PATHS['claude-3-opus']).toBe('claude-3.5-sonnet');
  });

  it('maps gpt-4o to gpt-4o-mini', () => {
    expect(DOWNGRADE_PATHS['gpt-4o']).toBe('gpt-4o-mini');
  });

  it('maps o-series to mini variants', () => {
    expect(DOWNGRADE_PATHS['o1']).toBe('o1-mini');
    expect(DOWNGRADE_PATHS['o3']).toBe('o3-mini');
  });
});

describe('getDowngradePath', () => {
  it('ignores provider prefixes, case and dated suffixes', () => {
    expect(getDowngradePath('anthropic/Claude-3-Opus-20240229')).toBe('claude-3.5-sonnet');
    expect(getDowngradePath('gpt-4o-2024-08-06')).toBe('gpt-4o-mini');
  });

  it('returns null for a model with no cheaper sibling', () => {
    expect(getDowngradePath('gpt-4o-mini')).toBeNull();
    expect(getDowngradePath('')).toBeNull();
  });
});
