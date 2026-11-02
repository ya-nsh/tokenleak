import { resolveModelIdentity } from './normalizer';
import type { ModelPricing, PricingContext, PricingSource } from './pricing';
import { resolveModelPricing, TOKENS_PER_MILLION } from './pricing';

export interface CostContext extends PricingContext {
  /** Portion of `cacheWriteTokens` written with a 1-hour TTL. */
  cacheWrite1hTokens?: number;
}

export interface CostBreakdown {
  normalizedModel: string;
  pricing: ModelPricing | null;
  pricingSource: PricingSource | null;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

/**
 * Estimate the cost in USD for a given model and token usage.
 *
 * The model name is normalized before lookup (date suffixes are stripped).
 * If the model is not found in the pricing table, returns 0.
 *
 * @param model - Raw or normalized model name
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param cacheReadTokens - Number of cache read tokens
 * @param cacheWriteTokens - Number of cache write tokens
 * @returns Estimated cost in USD
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): number {
  return estimateCostBreakdown(
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  ).totalCost;
}

export function estimateCostBreakdown(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  context: CostContext = {},
): CostBreakdown {
  const normalized = resolveModelIdentity(model).model;
  const { cacheWrite1hTokens = 0, ...pricingContext } = context;
  const resolved = resolveModelPricing(model, {
    inputTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
    ...pricingContext,
  });

  if (!resolved) {
    return {
      normalizedModel: normalized,
      pricing: null,
      pricingSource: null,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      totalCost: 0,
    };
  }

  const { pricing } = resolved;
  // Never let a malformed 1h split exceed the total cache writes it is part of.
  const longTtlWrites = Math.min(Math.max(cacheWrite1hTokens, 0), cacheWriteTokens);
  const inputCost = (inputTokens / TOKENS_PER_MILLION) * pricing.input;
  const outputCost = (outputTokens / TOKENS_PER_MILLION) * pricing.output;
  const cacheReadCost = (cacheReadTokens / TOKENS_PER_MILLION) * pricing.cacheRead;
  const cacheWriteCost =
    ((cacheWriteTokens - longTtlWrites) / TOKENS_PER_MILLION) * pricing.cacheWrite +
    (longTtlWrites / TOKENS_PER_MILLION) * (pricing.cacheWrite1h ?? pricing.cacheWrite);

  return {
    normalizedModel: normalized,
    pricing,
    pricingSource: resolved.source,
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}
