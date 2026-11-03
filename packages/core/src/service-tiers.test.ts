import { describe, expect, it } from 'bun:test';
import { formatModelWithTier, mergeServiceTiers } from './service-tiers';

const tier = (name: string, tokens: number, configuredTokens?: number) => ({
  tier: name,
  tokens,
  cost: 0,
  unpricedTokens: 0,
  ...(configuredTokens === undefined ? {} : { configuredTokens }),
});

describe('formatModelWithTier', () => {
  it('labels recorded tiers plainly', () => {
    expect(formatModelWithTier('gpt-5.5', [tier('default', 10), tier('fast', 5)])).toBe('gpt-5.5 [Standard, Fast]');
  });

  it('marks a tier known only from settings', () => {
    expect(formatModelWithTier('gpt-5.5', [tier('default', 10, 10)])).toBe('gpt-5.5 [Standard (config)]');
  });

  it('drops the marker once any of the tier was recorded', () => {
    expect(formatModelWithTier('gpt-5.5', [tier('default', 10, 4)])).toBe('gpt-5.5 [Standard]');
  });

  it('keeps unknown tiers and bare models as before', () => {
    expect(formatModelWithTier('gpt-5.5', [tier('unknown', 10)])).toBe('gpt-5.5 [tier unknown]');
    expect(formatModelWithTier('gpt-5.5', [])).toBe('gpt-5.5');
    expect(formatModelWithTier('gpt-5.5')).toBe('gpt-5.5');
  });

  it('does not mark an empty tier', () => {
    expect(formatModelWithTier('gpt-5.5', [tier('default', 0, 0)])).toBe('gpt-5.5 [Standard]');
  });
});

describe('mergeServiceTiers', () => {
  it('sums configured tokens across groups and keeps them absent when none are configured', () => {
    const merged = mergeServiceTiers([tier('default', 10, 10)], [tier('default', 5)], [tier('default', 3, 3)]);
    expect(merged).toEqual([tier('default', 18, 13)]);
    expect(mergeServiceTiers([tier('fast', 1)], [tier('fast', 2)])[0]).not.toHaveProperty('configuredTokens');
  });

  it('does not mutate its inputs', () => {
    const input = [tier('default', 10, 10)];
    mergeServiceTiers(input, [tier('default', 5, 5)]);
    expect(input[0]).toEqual(tier('default', 10, 10));
  });
});
