import { describe, expect, test } from 'bun:test';
import { normalizeModelName } from './normalizer';
import { getModelPricing, MODEL_PRICING } from './pricing';
import { estimateCost } from './cost';
import type { ModelPricing } from './pricing';

// ---------------------------------------------------------------------------
// normalizeModelName
// ---------------------------------------------------------------------------

describe('normalizeModelName', () => {
  test('strips -YYYYMMDD suffix from Claude model', () => {
    expect(normalizeModelName('claude-sonnet-4-20250514')).toBe('claude-sonnet-4');
  });

  test('strips -YYYYMMDD suffix from Claude 3.5 model', () => {
    expect(normalizeModelName('claude-3.5-sonnet-20241022')).toBe('claude-3.5-sonnet');
  });

  test('strips -YYYYMMDD with November date suffix', () => {
    expect(normalizeModelName('claude-3-opus-20251101')).toBe('claude-3-opus');
  });

  test('strips suffix from GPT model with date', () => {
    expect(normalizeModelName('gpt-4o-20240513')).toBe('gpt-4o');
  });

  test('returns model unchanged when no date suffix', () => {
    expect(normalizeModelName('gpt-4o')).toBe('gpt-4o');
  });

  test('returns model unchanged for o-series without suffix', () => {
    expect(normalizeModelName('o3-mini')).toBe('o3-mini');
  });

  test('handles empty string', () => {
    expect(normalizeModelName('')).toBe('');
  });

  test('does not strip partial date-like suffixes (7 digits)', () => {
    expect(normalizeModelName('model-1234567')).toBe('model-1234567');
  });

  test('does not strip 9-digit suffixes', () => {
    expect(normalizeModelName('model-123456789')).toBe('model-123456789');
  });

  test('strips date from claude-opus-4 variant', () => {
    expect(normalizeModelName('claude-opus-4-20250715')).toBe('claude-opus-4');
  });

  test('normalizes Pi preview naming variants', () => {
    expect(normalizeModelName('Pi (3.1-Preview)')).toBe('pi-3.1-preview');
    expect(normalizeModelName('pi 3.1 preview')).toBe('pi-3.1-preview');
  });

  test('normalizes Pi 3 variants', () => {
    expect(normalizeModelName('Pi (3.0)')).toBe('pi-3.0');
    expect(normalizeModelName('pi-3')).toBe('pi-3.0');
  });
});

// ---------------------------------------------------------------------------
// getModelPricing
// ---------------------------------------------------------------------------

describe('getModelPricing', () => {
  test('returns pricing for known Claude 3 model', () => {
    const pricing = getModelPricing('claude-3-haiku');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(0.25);
    expect(pricing!.output).toBe(1.25);
  });

  test('returns pricing for claude-sonnet-4', () => {
    const pricing = getModelPricing('claude-sonnet-4');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(3.00);
  });

  test('returns pricing for gpt-4o', () => {
    const pricing = getModelPricing('gpt-4o');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(2.50);
    expect(pricing!.output).toBe(10.00);
  });

  test('returns pricing for o3-mini', () => {
    const pricing = getModelPricing('o3-mini');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(1.10);
  });

  test('returns undefined for unknown model', () => {
    expect(getModelPricing('totally-unknown-model')).toBeUndefined();
  });

  test('pricing table contains all expected models', () => {
    const expected = [
      'claude-3-haiku', 'claude-3-sonnet', 'claude-3-opus',
      'claude-3.5-haiku', 'claude-3.5-sonnet',
      'claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-5',
      'claude-sonnet-4', 'claude-opus-4',
      'claude-sonnet-4-6', 'claude-opus-4-6',
      'gpt-4o', 'gpt-4o-mini',
      'o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini',
    ];
    for (const name of expected) {
      expect(MODEL_PRICING[name]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// estimateCost
// ---------------------------------------------------------------------------

describe('estimateCost', () => {
  test('returns 0 for unknown model', () => {
    expect(estimateCost('mystery-model', 1000, 1000, 0, 0)).toBe(0);
  });

  test('calculates cost for claude-3-haiku input/output only', () => {
    // 1M input at $0.25 + 1M output at $1.25 = $1.50
    const cost = estimateCost('claude-3-haiku', 1_000_000, 1_000_000, 0, 0);
    expect(cost).toBeCloseTo(1.50, 6);
  });

  test('calculates cost with cache tokens for claude-opus-4', () => {
    // 500k input at $15/M = $7.50
    // 200k output at $75/M = $15.00
    // 100k cache read at $1.50/M = $0.15
    // 50k cache write at $18.75/M = $0.9375
    const cost = estimateCost('claude-opus-4', 500_000, 200_000, 100_000, 50_000);
    expect(cost).toBeCloseTo(23.5875, 4);
  });

  test('normalizes model name before lookup', () => {
    // claude-sonnet-4-20250514 should be normalized to claude-sonnet-4
    const cost = estimateCost('claude-sonnet-4-20250514', 1_000_000, 0, 0, 0);
    expect(cost).toBeCloseTo(3.00, 6);
  });

  test('returns 0 cost for zero tokens on known model', () => {
    expect(estimateCost('gpt-4o', 0, 0, 0, 0)).toBe(0);
  });

  test('calculates gpt-4o-mini cost correctly', () => {
    // 2M input at $0.15/M = $0.30
    // 1M output at $0.60/M = $0.60
    const cost = estimateCost('gpt-4o-mini', 2_000_000, 1_000_000, 0, 0);
    expect(cost).toBeCloseTo(0.90, 6);
  });

  test('calculates o1 cost correctly', () => {
    // 100k input at $15/M = $1.50
    // 50k output at $60/M = $3.00
    const cost = estimateCost('o1', 100_000, 50_000, 0, 0);
    expect(cost).toBeCloseTo(4.50, 6);
  });
});
