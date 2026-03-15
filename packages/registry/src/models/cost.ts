import { normalizeModelName } from './normalizer';
import type { ModelPricing } from './pricing';
import { getModelPricing, TOKENS_PER_MILLION } from './pricing';

export interface CostBreakdown {
  normalizedModel: string;
  pricing: ModelPricing | null;
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
): CostBreakdown {
  const normalized = normalizeModelName(model);
  const pricing = getModelPricing(normalized);

  if (!pricing) {
    return {
      normalizedModel: normalized,
      pricing: null,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      totalCost: 0,
    };
  }

  const inputCost = (inputTokens / TOKENS_PER_MILLION) * pricing.input;
  const outputCost = (outputTokens / TOKENS_PER_MILLION) * pricing.output;
  const cacheReadCost = (cacheReadTokens / TOKENS_PER_MILLION) * pricing.cacheRead;
  const cacheWriteCost = (cacheWriteTokens / TOKENS_PER_MILLION) * pricing.cacheWrite;

  return {
    normalizedModel: normalized,
    pricing,
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}
