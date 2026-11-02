import { getOverridePricing, getRemotePricing, listOverrideModels } from './pricing-resolver';
import { getDowngradePath } from '@tokenleak/core';
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
  /** USD per 1M cache write tokens (5-minute TTL where TTLs exist) */
  cacheWrite: number;
  /** USD per 1M cache write tokens with a 1-hour TTL, when it differs */
  cacheWrite1h?: number;
}

/** Anthropic bills 5-minute cache writes at 1.25x input and 1-hour writes at 2x. */
const ANTHROPIC_CACHE_WRITE_5M_MULTIPLIER = 1.25;
const ANTHROPIC_CACHE_WRITE_1H_MULTIPLIER = 2;
const ANTHROPIC_STANDARD_CACHE_READ_MULTIPLIER = 0.1;

function anthropicPricing(
  input: number,
  output: number,
  cacheReadMultiplier = ANTHROPIC_STANDARD_CACHE_READ_MULTIPLIER,
): ModelPricing {
  return {
    input,
    output,
    cacheRead: input * cacheReadMultiplier,
    cacheWrite: input * ANTHROPIC_CACHE_WRITE_5M_MULTIPLIER,
    cacheWrite1h: input * ANTHROPIC_CACHE_WRITE_1H_MULTIPLIER,
  };
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
  'claude-opus-4-1': anthropicPricing(15, 75),

  // Claude 4.8 / 5.x family
  // Verified 2026-11-02: https://platform.claude.com/docs/en/about-claude/pricing
  'claude-opus-4-8': anthropicPricing(5, 25),
  'claude-opus-5': anthropicPricing(5, 25),
  'claude-opus-5-5': anthropicPricing(4, 20, 0.05),
  'claude-sonnet-5': anthropicPricing(2, 10),
  'claude-sonnet-5-5': anthropicPricing(2, 10, 0.05),
  // Prompts up to 100K tokens; longer prompts use LONG_PROMPT_PRICING.
  'claude-haiku-5-5': anthropicPricing(0.1, 0.5),
  'claude-fable-5': anthropicPricing(10, 50),
  'claude-fable-5-1': anthropicPricing(10, 50, 0.025),
  'claude-mythos-5': anthropicPricing(10, 50),
  'claude-mythos-5-1': anthropicPricing(10, 50, 0.025),

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

/** Where a resolved price came from, most to least trusted. */
export type PricingSource = 'override' | 'verified' | 'remote';

export interface ResolvedPricing {
  pricing: ModelPricing;
  source: PricingSource;
}

export interface PricingContext {
  serviceTier?: string;
  /** Full request input, including cached input. Never a session cumulative total. */
  inputTokens?: number;
  /** Anthropic `inference_geo`; `us` carries a regional surcharge on 4.6+ models. */
  inferenceGeo?: string;
}

// API Fast prices, not ChatGPT subscription credit multipliers.
// https://developers.openai.com/api/docs/pricing (Fast mode / All models)
// https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing
// Claude caching multipliers apply on top of the fast base rates.
const FAST_PRICING: Readonly<Record<string, ModelPricing>> = {
  'gpt-5.6-sol': { input: 8, output: 40, cacheRead: 0.8, cacheWrite: 10 },
  'gpt-5.6-terra': { input: 4, output: 24, cacheRead: 0.4, cacheWrite: 5 },
  'gpt-5.6-luna': { input: 0.4, output: 2.4, cacheRead: 0.04, cacheWrite: 0.5 },
  'gpt-5.5': { input: 12.5, output: 75, cacheRead: 1.25, cacheWrite: 12.5 },
  'gpt-5.4': { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 },
  'gpt-5.4-mini': { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 1.5 },
  'gpt-5.3-codex': { input: 3.5, output: 28, cacheRead: 0.35, cacheWrite: 3.5 },
  'claude-opus-5-5': anthropicPricing(8, 40, 0.05),
  'claude-opus-5': anthropicPricing(10, 50),
  'claude-opus-4-8': anthropicPricing(10, 50),
};

/** Models whose price steps up once a single request's prompt crosses a threshold. */
const LONG_PROMPT_PRICING: Readonly<
  Record<string, { thresholdTokens: number; pricing: ModelPricing }>
> = {
  'claude-haiku-5-5': { thresholdTokens: 100_000, pricing: anthropicPricing(0.5, 2.5) },
};

const OPENAI_LONG_CONTEXT_THRESHOLD_TOKENS = 272_000;
const US_INFERENCE_GEO_MULTIPLIER = 1.1;
/** Claude 4.6 and later bill `inference_geo: "us"` at 1.1x every rate. */
const US_GEO_SURCHARGE_MODEL = /^claude-(?:(?:opus|sonnet|haiku)-(?:4-[6-9]|[5-9](?:-\d+)?)|fable-|mythos-)/;

/** Tiers that bill at the model's standard rate. */
function isStandardTier(tier: string | undefined): boolean {
  return tier === undefined || tier === 'default' || tier === 'auto' || tier === 'unknown';
}

function withAnthropicLongTtl(model: string, pricing: ModelPricing): ModelPricing {
  if (pricing.cacheWrite1h !== undefined || !model.startsWith('claude-')) return pricing;
  return { ...pricing, cacheWrite1h: pricing.input * ANTHROPIC_CACHE_WRITE_1H_MULTIPLIER };
}

function scalePricing(pricing: ModelPricing, factor: number): ModelPricing {
  return {
    input: pricing.input * factor,
    output: pricing.output * factor,
    cacheRead: pricing.cacheRead * factor,
    cacheWrite: pricing.cacheWrite * factor,
    ...(pricing.cacheWrite1h !== undefined ? { cacheWrite1h: pricing.cacheWrite1h * factor } : {}),
  };
}

function refineWithRemote(model: string, local: ModelPricing): ModelPricing {
  const remote = getRemotePricing(model);
  // Only the vendor's own row may adjust a verified rate.
  if (!remote?.firstParty) return local;
  const valid = (value: number | undefined, backup: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : backup;
  return {
    input: valid(remote.input, local.input),
    output: valid(remote.output, local.output),
    cacheRead: valid(remote.cacheRead, local.cacheRead),
    cacheWrite: valid(remote.cacheWrite, local.cacheWrite),
    ...(local.cacheWrite1h !== undefined || remote.cacheWrite1h !== undefined
      ? { cacheWrite1h: valid(remote.cacheWrite1h, local.cacheWrite1h ?? local.cacheWrite) }
      : {}),
  };
}

function standardPricing(model: string): ResolvedPricing | undefined {
  const local = MODEL_PRICING[model];
  if (local) return { pricing: refineWithRemote(model, local), source: 'verified' };
  const remote = getRemotePricing(model);
  if (remote?.firstParty) {
    const pricing: ModelPricing = {
      input: remote.input,
      output: remote.output,
      cacheRead: remote.cacheRead,
      cacheWrite: remote.cacheWrite,
      ...(remote.cacheWrite1h !== undefined ? { cacheWrite1h: remote.cacheWrite1h } : {}),
    };
    return { pricing, source: 'remote' };
  }
  return undefined;
}

/**
 * Resolve pricing for a raw model name, and say where the price came from.
 *
 * Precedence:
 * 1. The user's override file — they know their contract.
 * 2. The verified local table, refined by the vendor's own LiteLLM row.
 * 3. The vendor's own LiteLLM row for models released after this build.
 *    Reseller and regional rows never price a model on their own.
 *
 * Premium tiers (fast, flex) only resolve where their rates are known;
 * guessing a tier multiplier would turn an unknown into a wrong number.
 */
export function resolveModelPricing(
  rawModel: string,
  context: PricingContext = {},
): ResolvedPricing | undefined {
  const identity = resolveModelIdentity(rawModel);
  const model = identity.model;
  const tier = normalizeServiceTier(context.serviceTier) ?? identity.serviceTier;
  const promptTokens = context.inputTokens ?? 0;

  const override = getOverridePricing(model);
  if (override) {
    return { pricing: withAnthropicLongTtl(model, override), source: 'override' };
  }

  const standard = standardPricing(model);
  if (!standard) return undefined;

  const openAiLongContext =
    promptTokens > OPENAI_LONG_CONTEXT_THRESHOLD_TOKENS &&
    (model.startsWith('gpt-5.6-') || model === 'gpt-5.5' || model === 'gpt-5.4');

  let pricing: ModelPricing;
  if (tier === 'fast') {
    const fast = FAST_PRICING[model];
    if (!fast || (openAiLongContext && !model.startsWith('gpt-5.6-'))) return undefined;
    pricing = fast;
  } else if (tier === 'flex') {
    // Restrict discount assumptions to models with verified Flex support.
    if (!model.startsWith('gpt-5.6-') && model !== 'gpt-5.5' && model !== 'gpt-5.4') return undefined;
    pricing = scalePricing(standard.pricing, 0.5);
  } else if (isStandardTier(tier)) {
    const longPrompt = LONG_PROMPT_PRICING[model];
    pricing =
      longPrompt && promptTokens > longPrompt.thresholdTokens ? longPrompt.pricing : standard.pricing;
  } else {
    return undefined;
  }

  if (openAiLongContext) {
    pricing = { input: pricing.input * 2, output: pricing.output * 1.5,
      cacheRead: pricing.cacheRead * 2, cacheWrite: pricing.cacheWrite * 2 };
  }
  if (context.inferenceGeo === 'us' && US_GEO_SURCHARGE_MODEL.test(model)) {
    pricing = scalePricing(pricing, US_INFERENCE_GEO_MULTIPLIER);
  }
  return { pricing: withAnthropicLongTtl(model, pricing), source: standard.source };
}

/** Pricing for a raw model name, or undefined when no trustworthy rate exists. */
export function getModelPricing(rawModel: string, context: PricingContext = {}): ModelPricing | undefined {
  return resolveModelPricing(rawModel, context)?.pricing;
}

/**
 * A standard-tier price table covering every model the caller names, for
 * analyses (advisor, routing simulator) that compare models by rate.
 */
export function buildPricingTable(models: Iterable<string>): Record<string, ModelPricing> {
  const table: Record<string, ModelPricing> = {};
  const names = new Set<string>([...Object.keys(MODEL_PRICING), ...listOverrideModels()]);
  for (const model of models) {
    const name = resolveModelIdentity(model).model;
    names.add(name);
    // Analyses compare a model against its cheaper sibling, so price both.
    const downgrade = getDowngradePath(name);
    if (downgrade) names.add(downgrade);
  }
  for (const name of names) {
    const pricing = getModelPricing(name);
    if (pricing) table[name] = pricing;
  }
  return table;
}

export { TOKENS_PER_MILLION };
