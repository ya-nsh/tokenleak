import type {
  CachePricingDetails,
  CostSource,
  ProviderWarning,
  UsageEvent,
} from '@tokenleak/core';
import { buildEventCostCompleteness } from '@tokenleak/core';
import { estimateCostBreakdown } from './models/cost';

export interface UsageCostResult {
  cost: number;
  pricing: CachePricingDetails | undefined;
  costSource: CostSource;
  pricedTokens: number;
  unpricedTokens: number;
}

interface UsageCostInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  explicitCost?: number;
}

function totalTokens(input: UsageCostInput): number {
  return input.inputTokens + input.outputTokens + input.cacheReadTokens + input.cacheWriteTokens;
}

export function incrementProviderWarning(
  warnings: Map<string, ProviderWarning>,
  kind: ProviderWarning['kind'],
  file: string,
): void {
  const key = `${kind}:${file}`;
  const existing = warnings.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }

  warnings.set(key, { kind, file, count: 1 });
}

export function resolveUsageCost(input: UsageCostInput): UsageCostResult {
  const costBreakdown = estimateCostBreakdown(
    input.model,
    input.inputTokens,
    input.outputTokens,
    input.cacheReadTokens,
    input.cacheWriteTokens,
  );
  const tokenCount = totalTokens(input);
  const pricing = costBreakdown.pricing
    ? {
        input: costBreakdown.pricing.input,
        cacheRead: costBreakdown.pricing.cacheRead,
        cacheWrite: costBreakdown.pricing.cacheWrite,
      }
    : undefined;

  if (typeof input.explicitCost === 'number' && Number.isFinite(input.explicitCost)) {
    return {
      cost: input.explicitCost,
      pricing,
      costSource: 'provider-reported',
      pricedTokens: tokenCount,
      unpricedTokens: 0,
    };
  }

  if (!costBreakdown.pricing && tokenCount > 0) {
    return {
      cost: 0,
      pricing: undefined,
      costSource: 'unpriced',
      pricedTokens: 0,
      unpricedTokens: tokenCount,
    };
  }

  return {
    cost: costBreakdown.totalCost,
    pricing,
    costSource: 'estimated',
    pricedTokens: tokenCount,
    unpricedTokens: 0,
  };
}

export function addUnknownPricingWarnings(
  warnings: Map<string, ProviderWarning>,
  events: UsageEvent[],
): void {
  const unknownModels = buildEventCostCompleteness(events).unknownModels;
  for (const model of unknownModels) {
    const count = events.filter(
      (event) => event.model === model && (event.unpricedTokens ?? 0) > 0,
    ).length;
    if (count > 0) {
      const key = `unknown-pricing:${model}`;
      warnings.set(key, { kind: 'unknown-pricing', file: model, count });
    }
  }
}

export { buildEventCostCompleteness };
