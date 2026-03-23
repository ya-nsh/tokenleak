import { afterEach, describe, expect, mock, test } from 'bun:test';
import { getRemotePricing, initPricing, resetPricingState } from './pricing-resolver';
import { MODEL_PRICING } from './pricing';

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
});
