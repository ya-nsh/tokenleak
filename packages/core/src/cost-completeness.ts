import type { CostCompleteness, DailyUsage, ProviderData, UsageEvent } from './types';

/** Distinguish absent estimates from a provider-reported zero cost. */
export function formatCostWithCompleteness(cost: number, completeness?: CostCompleteness): string {
  if (completeness?.status === 'unknown') return 'Unknown';
  return `$${cost.toFixed(2)}${completeness?.status === 'partial' ? '+' : ''}`;
}

function mergeUnknownModels(target: Set<string>, models: Iterable<string>): void {
  for (const model of models) {
    if (model.trim()) {
      target.add(model);
    }
  }
}

function emptyCostCompleteness(): CostCompleteness {
  return {
    status: 'complete',
    totalTokens: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
    unknownModels: [],
  };
}

function statusFor(totalTokens: number, unpricedTokens: number, hasKnownCostOnly = false): CostCompleteness['status'] {
  if (totalTokens === 0 || unpricedTokens === 0) {
    return 'complete';
  }

  if (unpricedTokens === totalTokens) {
    return hasKnownCostOnly ? 'partial' : 'unknown';
  }

  return 'partial';
}

/** Combine completeness for receipt clusters, including overflow and filtered views. */
export function combineCostCompleteness(parts: (CostCompleteness | undefined)[]): CostCompleteness {
  const result = emptyCostCompleteness();
  const models = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    if (part.hasKnownCostOnly) result.hasKnownCostOnly = true;
    result.totalTokens += part.totalTokens;
    result.pricedTokens += part.pricedTokens;
    result.unpricedTokens += part.unpricedTokens;
    mergeUnknownModels(models, part.unknownModels);
  }
  result.status = statusFor(result.totalTokens, result.unpricedTokens, result.hasKnownCostOnly);
  result.unknownModels = [...models].sort();
  return result;
}

export function buildEventCostCompleteness(events: UsageEvent[]): CostCompleteness {
  let hasKnownCostOnly = false;
  let totalTokens = 0;
  let pricedTokens = 0;
  let unpricedTokens = 0;
  const unknownModels = new Set<string>();

  for (const event of events) {
    if (event.totalTokens === 0 && event.cost > 0 && event.costSource !== 'unpriced') hasKnownCostOnly = true;
    totalTokens += event.totalTokens;
    const eventUnpriced =
      event.costSource === 'unpriced'
        ? (event.unpricedTokens ?? event.totalTokens)
        : (event.unpricedTokens ?? 0);
    const normalizedUnpriced = Math.min(event.totalTokens, Math.max(0, eventUnpriced));
    unpricedTokens += normalizedUnpriced;
    pricedTokens += Math.max(0, event.totalTokens - normalizedUnpriced);
    if (normalizedUnpriced > 0) {
      unknownModels.add(event.model);
    }
  }

  return {
    ...(hasKnownCostOnly ? { hasKnownCostOnly: true } : {}),
    status: statusFor(totalTokens, unpricedTokens, hasKnownCostOnly),
    totalTokens,
    pricedTokens,
    unpricedTokens,
    unknownModels: [...unknownModels].sort((a, b) => a.localeCompare(b)),
  };
}

export function buildDailyCostCompleteness(daily: DailyUsage[]): CostCompleteness {
  let hasKnownCostOnly = false;
  let totalTokens = 0;
  let pricedTokens = 0;
  let unpricedTokens = 0;
  const unknownModels = new Set<string>();

  for (const day of daily) {
    if (day.totalTokens === 0 && day.cost > 0) hasKnownCostOnly = true;
    totalTokens += day.totalTokens;
    let modeledTokens = 0;
    for (const model of day.models) {
      if (model.totalTokens === 0 && model.cost > 0 && model.costSource !== 'unpriced') hasKnownCostOnly = true;
      modeledTokens += model.totalTokens;
      const modelUnpriced =
        model.costSource === 'unpriced'
          ? (model.unpricedTokens ?? model.totalTokens)
          : (model.unpricedTokens ?? 0);
      const normalizedUnpriced = Math.min(model.totalTokens, Math.max(0, modelUnpriced));
      unpricedTokens += normalizedUnpriced;
      pricedTokens += Math.max(0, model.totalTokens - normalizedUnpriced);
      if (normalizedUnpriced > 0) {
        unknownModels.add(model.model);
      }
    }

    const unmodeledTokens = Math.max(0, day.totalTokens - modeledTokens);
    if (unmodeledTokens > 0) {
      if (day.cost > 0) {
        pricedTokens += unmodeledTokens;
      } else {
        unpricedTokens += unmodeledTokens;
      }
    }
  }

  return {
    ...(hasKnownCostOnly ? { hasKnownCostOnly: true } : {}),
    status: statusFor(totalTokens, unpricedTokens, hasKnownCostOnly),
    totalTokens,
    pricedTokens,
    unpricedTokens,
    unknownModels: [...unknownModels].sort((a, b) => a.localeCompare(b)),
  };
}

export function mergeCostCompleteness(providers: ProviderData[]): CostCompleteness {
  let hasKnownCostOnly = false;
  let totalTokens = 0;
  let pricedTokens = 0;
  let unpricedTokens = 0;
  const unknownModels = new Set<string>();

  for (const provider of providers) {
    const completeness = provider.costCompleteness ?? buildDailyCostCompleteness(provider.daily);
    hasKnownCostOnly ||= completeness.hasKnownCostOnly === true || (provider.totalTokens === 0 && provider.totalCost > 0);
    totalTokens += completeness.totalTokens;
    pricedTokens += completeness.pricedTokens;
    unpricedTokens += completeness.unpricedTokens;
    mergeUnknownModels(unknownModels, completeness.unknownModels);
  }

  return {
    ...(hasKnownCostOnly ? { hasKnownCostOnly: true } : {}),
    status: statusFor(totalTokens, unpricedTokens, hasKnownCostOnly),
    totalTokens,
    pricedTokens,
    unpricedTokens,
    unknownModels: [...unknownModels].sort((a, b) => a.localeCompare(b)),
  };
}
