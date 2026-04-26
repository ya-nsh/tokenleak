import { afterEach, describe, expect, test } from 'bun:test';
import {
  getRemotePricing,
  initPricing,
  resetPricingState,
  setRemotePricingForTest,
} from './pricing-resolver';

afterEach(() => {
  resetPricingState();
});

describe('resolveModelPricing via getRemotePricing', () => {
  test('returns undefined when no remote pricing is loaded', () => {
    expect(getRemotePricing('unknown-model')).toBeUndefined();
  });

  test('returns undefined for unknown models even after init', async () => {
    // initPricing may succeed or fail depending on network; either way,
    // a truly unknown model should return undefined
    try {
      await initPricing();
    } catch {
      // ignore
    }
    expect(getRemotePricing('definitely-not-a-real-model-xyz')).toBeUndefined();
  });
});

describe('resetPricingState', () => {
  test('clears remote pricing so it can be reinitialized', () => {
    resetPricingState();
    // After reset, getRemotePricing should return undefined for everything
    expect(getRemotePricing('gpt-4o')).toBeUndefined();
  });
});

describe('getModelPricing fallback chain', () => {
  // Import the function that consumers actually call
  const { getModelPricing } = require('./pricing');

  test('returns hardcoded pricing when no remote data is loaded', () => {
    resetPricingState();
    const pricing = getModelPricing('claude-3-opus');
    expect(pricing).toBeDefined();
    expect(pricing!.input).toBe(15.0);
    expect(pricing!.output).toBe(75.0);
  });

  test('returns undefined for unknown model when no remote data is loaded', () => {
    resetPricingState();
    expect(getModelPricing('nonexistent-model-abc')).toBeUndefined();
  });

  test('does not accept remote-only model pricing as verified pricing', () => {
    resetPricingState();
    setRemotePricingForTest({
      'nonexistent-model-abc': {
        input: 123,
        output: 456,
        cacheRead: 7,
        cacheWrite: 8,
      },
    });

    expect(getModelPricing('nonexistent-model-abc')).toBeUndefined();
  });

  test('allows remote pricing to update verified model rates', () => {
    resetPricingState();
    setRemotePricingForTest({
      'gpt-4o': {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
      },
    });

    expect(getModelPricing('gpt-4o')).toEqual({
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
    });
  });
});
