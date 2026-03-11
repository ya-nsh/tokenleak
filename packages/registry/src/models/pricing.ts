/**
 * Per-million-token pricing for supported models.
 *
 * Rates are in USD per 1 million tokens. Each entry specifies input, output,
 * cache read, and cache write rates.
 */

export interface ModelPricing {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M output tokens */
  output: number;
  /** USD per 1M cache read tokens */
  cacheRead: number;
  /** USD per 1M cache write tokens */
  cacheWrite: number;
}

const TOKENS_PER_MILLION = 1_000_000;

/**
 * Pricing table keyed by normalized model name.
 *
 * Values are USD per 1 million tokens.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // Claude 3 family
  'claude-3-haiku': {
    input: 0.25,
    output: 1.25,
    cacheRead: 0.03,
    cacheWrite: 0.30,
  },
  'claude-3-sonnet': {
    input: 3.00,
    output: 15.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  'claude-3-opus': {
    input: 15.00,
    output: 75.00,
    cacheRead: 1.50,
    cacheWrite: 18.75,
  },

  // Claude 3.5 family
  'claude-3.5-haiku': {
    input: 0.80,
    output: 4.00,
    cacheRead: 0.08,
    cacheWrite: 1.00,
  },
  'claude-3.5-sonnet': {
    input: 3.00,
    output: 15.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },

  // Claude 4 family
  'claude-sonnet-4': {
    input: 3.00,
    output: 15.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  'claude-opus-4': {
    input: 15.00,
    output: 75.00,
    cacheRead: 1.50,
    cacheWrite: 18.75,
  },

  // OpenAI GPT-4o family
  'gpt-4o': {
    input: 2.50,
    output: 10.00,
    cacheRead: 1.25,
    cacheWrite: 2.50,
  },
  'gpt-4o-mini': {
    input: 0.15,
    output: 0.60,
    cacheRead: 0.075,
    cacheWrite: 0.15,
  },

  // OpenAI o-series reasoning models
  'o1': {
    input: 15.00,
    output: 60.00,
    cacheRead: 7.50,
    cacheWrite: 15.00,
  },
  'o1-mini': {
    input: 3.00,
    output: 12.00,
    cacheRead: 1.50,
    cacheWrite: 3.00,
  },
  'o3': {
    input: 10.00,
    output: 40.00,
    cacheRead: 5.00,
    cacheWrite: 10.00,
  },
  'o3-mini': {
    input: 1.10,
    output: 4.40,
    cacheRead: 0.55,
    cacheWrite: 1.10,
  },
  'o4-mini': {
    input: 1.10,
    output: 4.40,
    cacheRead: 0.55,
    cacheWrite: 1.10,
  },
};

/**
 * Look up pricing for a normalized model name.
 * Returns `undefined` if the model is not in the pricing table.
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  return MODEL_PRICING[model];
}

export { TOKENS_PER_MILLION };
