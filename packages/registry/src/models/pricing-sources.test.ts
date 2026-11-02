import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { estimateCostBreakdown } from './cost';
import { normalizeModelName } from './normalizer';
import { buildPricingTable, getModelPricing, resolveModelPricing } from './pricing';
import {
  PricingOverrideError,
  loadPricingOverrides,
  parsePricingOverrides,
} from './pricing-overrides';
import {
  resetPricingState,
  setOverridePricingForTest,
  setRemotePricingForTest,
} from './pricing-resolver';

afterEach(() => {
  resetPricingState();
});

describe('verified Claude 5.x rates', () => {
  test('Opus 5.5 uses the 0.05x cache read multiplier', () => {
    expect(getModelPricing('claude-opus-5-5')).toEqual({
      input: 4,
      output: 20,
      cacheRead: 0.2,
      cacheWrite: 5,
      cacheWrite1h: 8,
    });
  });

  test('Sonnet 5.5 and Sonnet 5 differ only in cache reads', () => {
    expect(getModelPricing('claude-sonnet-5-5')!.cacheRead).toBeCloseTo(0.1);
    expect(getModelPricing('claude-sonnet-5')!.cacheRead).toBeCloseTo(0.2);
    expect(getModelPricing('claude-sonnet-5')!.input).toBe(2);
  });

  test('Fable 5.1 cache reads are 0.025x input', () => {
    expect(getModelPricing('claude-fable-5-1')!.cacheRead).toBeCloseTo(0.25);
    expect(getModelPricing('claude-fable-5')!.cacheRead).toBeCloseTo(1);
  });

  test('older Claude rows gain a 2x-input 1h cache write rate', () => {
    expect(getModelPricing('claude-opus-4-7')!.cacheWrite1h).toBe(10);
    expect(getModelPricing('claude-sonnet-4-6')!.cacheWrite1h).toBe(6);
  });

  test('OpenAI rows have no separate 1h rate', () => {
    expect(getModelPricing('gpt-4o')!.cacheWrite1h).toBeUndefined();
  });

  test('verified rows report their source', () => {
    expect(resolveModelPricing('claude-opus-5-5')!.source).toBe('verified');
  });
});

describe('Haiku 5.5 long prompts', () => {
  test('prompts at the 100K threshold keep the base rate', () => {
    expect(getModelPricing('claude-haiku-5-5', { inputTokens: 100_000 })!.input).toBeCloseTo(0.1);
  });

  test('prompts over 100K tokens pay 5x', () => {
    const pricing = getModelPricing('claude-haiku-5-5', { inputTokens: 100_001 })!;
    expect(pricing.input).toBeCloseTo(0.5);
    expect(pricing.output).toBeCloseTo(2.5);
    expect(pricing.cacheRead).toBeCloseTo(0.05);
  });
});

describe('Claude fast mode and inference geography', () => {
  test('fast mode Opus 5.5 is $8/$40 with caching multipliers on top', () => {
    const pricing = getModelPricing('claude-opus-5-5', { serviceTier: 'fast' })!;
    expect(pricing.input).toBe(8);
    expect(pricing.output).toBe(40);
    expect(pricing.cacheRead).toBeCloseTo(0.4);
  });

  test('fast mode is unpriced for models without published fast rates', () => {
    expect(getModelPricing('claude-sonnet-5-5', { serviceTier: 'fast' })).toBeUndefined();
  });

  test('US-only inference costs 1.1x on 4.6+ models', () => {
    expect(getModelPricing('claude-opus-5-5', { inferenceGeo: 'us' })!.input).toBeCloseTo(4.4);
    expect(getModelPricing('claude-opus-4-6', { inferenceGeo: 'us' })!.output).toBeCloseTo(27.5);
  });

  test('US-only inference does not surcharge pre-4.6 models', () => {
    expect(getModelPricing('claude-sonnet-4-5', { inferenceGeo: 'us' })!.input).toBe(3);
  });
});

describe('1-hour cache writes', () => {
  test('bills the 1h share at 2x input and the rest at 1.25x', () => {
    const breakdown = estimateCostBreakdown('claude-opus-5-5', 0, 0, 0, 1_000_000, {
      cacheWrite1hTokens: 400_000,
    });
    // 600K * $5 + 400K * $8
    expect(breakdown.cacheWriteCost).toBeCloseTo(3 + 3.2);
    expect(breakdown.pricingSource).toBe('verified');
  });

  test('clamps a 1h share larger than total cache writes', () => {
    const breakdown = estimateCostBreakdown('claude-opus-5-5', 0, 0, 0, 100, {
      cacheWrite1hTokens: 500,
    });
    expect(breakdown.cacheWriteCost).toBeCloseTo((100 / 1_000_000) * 8);
  });

  test('unknown models report a null pricing source', () => {
    expect(estimateCostBreakdown('mystery', 1, 1, 0, 0).pricingSource).toBeNull();
  });
});

describe('user overrides', () => {
  test('override beats the verified table', () => {
    setOverridePricingForTest({
      'claude-opus-5-5': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
    });
    const resolved = resolveModelPricing('claude-opus-5-5-20260101')!;
    expect(resolved.source).toBe('override');
    expect(resolved.pricing.input).toBe(1);
    expect(resolved.pricing.cacheWrite1h).toBe(2);
  });

  test('override prices a model nobody else knows', () => {
    setOverridePricingForTest({
      'in-house-model': { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    });
    expect(getModelPricing('in-house-model')!.input).toBe(1);
  });

  test('parses defaults for omitted cache rates', () => {
    const parsed = parsePricingOverrides('x.json', { models: { foo: { input: 2, output: 8 } } });
    expect(parsed['foo']).toEqual({ input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 });
  });

  test('normalizes override model names', () => {
    const parsed = parsePricingOverrides('x.json', {
      models: { 'claude-opus-5.5-20260101': { input: 1, output: 1 } },
    });
    expect(Object.keys(parsed)).toEqual(['claude-opus-5-5']);
  });

  test.each([
    [[], 'top level must be an object'],
    [{}, '"models" must be an object'],
    [{ models: { foo: 3 } }, '"foo" must be an object of rates'],
    [{ models: { foo: { input: 1 } } }, '"foo.output" must be a non-negative number'],
    [{ models: { foo: { input: -1, output: 1 } } }, '"foo.input" must be a non-negative number'],
    [{ models: { foo: { input: 1, output: 1, cache: 1 } } }, '"foo.cache" is not a pricing field'],
  ])('rejects %j with an actionable message', (raw, message) => {
    expect(() => parsePricingOverrides('/tmp/pricing.json', raw)).toThrow(PricingOverrideError);
    expect(() => parsePricingOverrides('/tmp/pricing.json', raw)).toThrow(message);
  });

  test('a missing override file means no overrides', () => {
    expect(loadPricingOverrides(join(tmpdir(), 'tokenleak-does-not-exist.json'))).toEqual({});
  });

  test('a corrupt override file names the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokenleak-overrides-'));
    try {
      const path = join(dir, 'pricing.json');
      writeFileSync(path, '{ not json');
      expect(() => loadPricingOverrides(path)).toThrow(`Invalid pricing override file ${path}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildPricingTable', () => {
  test('covers verified models and remote-priced models the caller names', () => {
    setRemotePricingForTest({
      'gpt-6.1-sol': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, firstParty: true },
    });
    const table = buildPricingTable(['gpt-6.1-sol', 'not-a-model']);
    expect(table['gpt-6.1-sol']!.input).toBe(2);
    expect(table['claude-opus-5-5']!.input).toBe(4);
    expect(table['not-a-model']).toBeUndefined();
  });
});

describe('dotted Claude model names', () => {
  test.each([
    ['claude-opus-5.5', 'claude-opus-5-5'],
    ['claude-haiku-5.5', 'claude-haiku-5-5'],
    ['claude-sonnet-4.6-20260101', 'claude-sonnet-4-6'],
    ['claude-3.5-sonnet', 'claude-3.5-sonnet'],
  ])('%s normalizes to %s', (raw, expected) => {
    expect(normalizeModelName(raw)).toBe(expected);
  });
});
