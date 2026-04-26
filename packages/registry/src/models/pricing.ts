import { getRemotePricing } from './pricing-resolver';

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

  // Claude 4.5+ family
  'claude-haiku-4-5': {
    input: 1.00,
    output: 5.00,
    cacheRead: 0.10,
    cacheWrite: 1.25,
  },
  'claude-sonnet-4-5': {
    input: 3.00,
    output: 15.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  'claude-opus-4-5': {
    input: 5.00,
    output: 25.00,
    cacheRead: 0.50,
    cacheWrite: 6.25,
  },

  // Claude 4/4.6 family
  'claude-sonnet-4': {
    input: 3.00,
    output: 15.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  'claude-sonnet-4-6': {
    input: 3.00,
    output: 15.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  'claude-haiku-4-6': {
    input: 1.00,
    output: 5.00,
    cacheRead: 0.10,
    cacheWrite: 1.25,
  },
  'claude-opus-4': {
    input: 15.00,
    output: 75.00,
    cacheRead: 1.50,
    cacheWrite: 18.75,
  },
  'claude-opus-4-6': {
    input: 5.00,
    output: 25.00,
    cacheRead: 0.50,
    cacheWrite: 6.25,
  },
  'claude-opus-4-7': {
    input: 5.00,
    output: 25.00,
    cacheRead: 0.50,
    cacheWrite: 6.25,
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
  'gpt-4.1': {
    input: 2.00,
    output: 8.00,
    cacheRead: 0.50,
    cacheWrite: 2.00,
  },
  'gpt-4.1-mini': {
    input: 0.40,
    output: 1.60,
    cacheRead: 0.10,
    cacheWrite: 0.40,
  },
  'gpt-4.1-nano': {
    input: 0.10,
    output: 0.40,
    cacheRead: 0.025,
    cacheWrite: 0.10,
  },

  // OpenAI GPT-5 family
  'gpt-5.5': {
    input: 5.00,
    output: 30.00,
    cacheRead: 0.50,
    cacheWrite: 5.00,
  },
  'gpt-5.4': {
    input: 2.50,
    output: 15.00,
    cacheRead: 0.25,
    cacheWrite: 2.50,
  },
  'gpt-5.4-mini': {
    input: 0.75,
    output: 4.50,
    cacheRead: 0.075,
    cacheWrite: 0.75,
  },
  'gpt-5.4-nano': {
    input: 0.20,
    output: 1.25,
    cacheRead: 0.02,
    cacheWrite: 0.20,
  },
  'gpt-5.3-codex': {
    input: 1.75,
    output: 14.00,
    cacheRead: 0.175,
    cacheWrite: 1.75,
  },
  'gpt-5.3-chat-latest': {
    input: 1.75,
    output: 14.00,
    cacheRead: 0.175,
    cacheWrite: 1.75,
  },
  'gpt-5': {
    input: 1.25,
    output: 10.00,
    cacheRead: 0.125,
    cacheWrite: 1.25,
  },
  'gpt-5.1': {
    input: 1.25,
    output: 10.00,
    cacheRead: 0.125,
    cacheWrite: 1.25,
  },
  'gpt-5.2': {
    input: 1.75,
    output: 14.00,
    cacheRead: 0.175,
    cacheWrite: 1.75,
  },
  'gpt-5-mini': {
    input: 0.25,
    output: 2.00,
    cacheRead: 0.025,
    cacheWrite: 0.25,
  },
  'gpt-5-nano': {
    input: 0.05,
    output: 0.40,
    cacheRead: 0.005,
    cacheWrite: 0.05,
  },
  'gpt-5-codex': {
    input: 1.25,
    output: 10.00,
    cacheRead: 0.125,
    cacheWrite: 1.25,
  },
  'gpt-5.1-codex': {
    input: 1.25,
    output: 10.00,
    cacheRead: 0.125,
    cacheWrite: 1.25,
  },
  'gpt-5.1-codex-max': {
    input: 1.25,
    output: 10.00,
    cacheRead: 0.125,
    cacheWrite: 1.25,
  },
  'gpt-5.2-codex': {
    input: 1.75,
    output: 14.00,
    cacheRead: 0.175,
    cacheWrite: 1.75,
  },
  'gpt-5.1-codex-mini': {
    input: 0.25,
    output: 2.00,
    cacheRead: 0.025,
    cacheWrite: 0.25,
  },
  'codex-mini-latest': {
    input: 1.50,
    output: 6.00,
    cacheRead: 0.375,
    cacheWrite: 1.50,
  },

  // OpenAI o-series reasoning models
  'o1': {
    input: 15.00,
    output: 60.00,
    cacheRead: 7.50,
    cacheWrite: 15.00,
  },
  'o1-mini': {
    input: 1.10,
    output: 4.40,
    cacheRead: 0.55,
    cacheWrite: 1.10,
  },
  'o3': {
    input: 2.00,
    output: 8.00,
    cacheRead: 0.50,
    cacheWrite: 2.00,
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
    cacheRead: 0.275,
    cacheWrite: 1.10,
  },
};

/**
 * Look up pricing for a normalized model name.
 *
 * Delegates to the pricing resolver only for models that are already present
 * in the verified local table. This lets remote pricing update known rates
 * without turning unsupported or speculative model names into exact costs.
 * If `initPricing()` has not been called, this behaves identically to a direct
 * `MODEL_PRICING` lookup.
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  const fallback = MODEL_PRICING[model];
  if (!fallback) {
    return undefined;
  }

  const remote = getRemotePricing(model);
  if (!remote) {
    return fallback;
  }

  return {
    input: remote.input > 0 ? remote.input : fallback.input,
    output: remote.output > 0 ? remote.output : fallback.output,
    cacheRead: remote.cacheRead > 0 ? remote.cacheRead : fallback.cacheRead,
    cacheWrite: remote.cacheWrite > 0 ? remote.cacheWrite : fallback.cacheWrite,
  };
}

export { TOKENS_PER_MILLION };
