import { getRemotePricing } from './pricing-resolver';
import { normalizeServiceTier, resolveModelIdentity } from './normalizer';

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
  // Verified 2026-09-04: https://developers.openai.com/api/docs/pricing
  'gpt-5.6-sol': { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  'gpt-5.6-terra': { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
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
export interface PricingContext {
  serviceTier?: string;
  /** Full request input, including cached input. Never a session cumulative total. */
  inputTokens?: number;
}

// API Fast prices, not ChatGPT subscription credit multipliers.
// https://developers.openai.com/api/docs/pricing (Fast mode / All models)
const FAST_PRICING: Readonly<Record<string, ModelPricing>> = {
  'gpt-5.6-sol': { input: 8, output: 40, cacheRead: 0.8, cacheWrite: 10 },
  'gpt-5.6-terra': { input: 4, output: 24, cacheRead: 0.4, cacheWrite: 5 },
  'gpt-5.6-luna': { input: 0.4, output: 2.4, cacheRead: 0.04, cacheWrite: 0.5 },
  'gpt-5.5': { input: 12.5, output: 75, cacheRead: 1.25, cacheWrite: 12.5 },
  'gpt-5.4': { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 },
  'gpt-5.4-mini': { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 1.5 },
  'gpt-5.3-codex': { input: 3.5, output: 28, cacheRead: 0.35, cacheWrite: 3.5 },
};

export function getModelPricing(rawModel: string, context: PricingContext = {}): ModelPricing | undefined {
  const identity = resolveModelIdentity(rawModel);
  const model = identity.model;
  const tier = normalizeServiceTier(context.serviceTier) ?? identity.serviceTier;
  const fallback = MODEL_PRICING[model];
  if (!fallback) {
    return undefined;
  }

  const longContext = (context.inputTokens ?? 0) > 272_000 &&
    (model.startsWith('gpt-5.6-') || model === 'gpt-5.5' || model === 'gpt-5.4');
  let pricing: ModelPricing;
  if (tier === 'fast') {
    const fast = FAST_PRICING[model];
    if (!fast || (longContext && !model.startsWith('gpt-5.6-'))) return undefined;
    pricing = fast;
  } else if (tier === 'flex') {
    // Restrict discount assumptions to models with verified Flex support.
    if (!model.startsWith('gpt-5.6-') && model !== 'gpt-5.5' && model !== 'gpt-5.4') return undefined;
    pricing = { input: fallback.input / 2, output: fallback.output / 2,
      cacheRead: fallback.cacheRead / 2, cacheWrite: fallback.cacheWrite / 2 };
  } else if (tier === 'ultrafast') {
    return undefined;
  } else {
    const remote = getRemotePricing(model);
    const valid = (value: number | undefined, backup: number) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : backup;
    pricing = {
      input: valid(remote?.input, fallback.input),
      output: valid(remote?.output, fallback.output),
      cacheRead: valid(remote?.cacheRead, fallback.cacheRead),
      cacheWrite: valid(remote?.cacheWrite, fallback.cacheWrite),
    };
  }
  return longContext ? { input: pricing.input * 2, output: pricing.output * 1.5,
    cacheRead: pricing.cacheRead * 2, cacheWrite: pricing.cacheWrite * 2 } : pricing;
}

export { TOKENS_PER_MILLION };
