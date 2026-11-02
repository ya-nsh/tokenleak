import type { CostCompleteness, DailyUsage, ModelBreakdown, ProviderData, UsageEvent } from './types';
import { formatUsd } from './format';

/** Distinguish absent estimates from a provider-reported zero cost. */
export function formatCostWithCompleteness(cost: number, completeness?: CostCompleteness): string {
  if (completeness?.status === 'unknown') return 'Unknown';
  return `${formatUsd(cost)}${completeness?.status === 'partial' ? '+' : ''}`;
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

type PricedUsage = Pick<UsageEvent, 'model' | 'totalTokens' | 'cost' | 'costSource' | 'unpricedTokens'>;

/**
 * Running completeness for rows built one event (or model breakdown) at a
 * time, such as sessions, projects, flow blocks, and report rows. Lets any
 * row say "Unknown" instead of a misleading "$0.00".
 */
export class CostCompletenessAccumulator {
  private hasKnownCostOnly = false;
  private totalTokens = 0;
  private pricedTokens = 0;
  private unpricedTokens = 0;
  private readonly unknownModels = new Set<string>();

  add(usage: PricedUsage): this {
    if (usage.totalTokens === 0 && usage.cost > 0 && usage.costSource !== 'unpriced') {
      this.hasKnownCostOnly = true;
    }
    this.totalTokens += usage.totalTokens;
    const unpriced =
      usage.costSource === 'unpriced'
        ? (usage.unpricedTokens ?? usage.totalTokens)
        : (usage.unpricedTokens ?? 0);
    const normalized = Math.min(usage.totalTokens, Math.max(0, unpriced));
    this.unpricedTokens += normalized;
    this.pricedTokens += Math.max(0, usage.totalTokens - normalized);
    if (normalized > 0) this.unknownModels.add(usage.model);
    return this;
  }

  result(): CostCompleteness {
    return {
      ...(this.hasKnownCostOnly ? { hasKnownCostOnly: true } : {}),
      status: statusFor(this.totalTokens, this.unpricedTokens, this.hasKnownCostOnly),
      totalTokens: this.totalTokens,
      pricedTokens: this.pricedTokens,
      unpricedTokens: this.unpricedTokens,
      unknownModels: [...this.unknownModels].sort((a, b) => a.localeCompare(b)),
    };
  }
}

export function buildEventCostCompleteness(events: readonly UsageEvent[]): CostCompleteness {
  const accumulator = new CostCompletenessAccumulator();
  for (const event of events) accumulator.add(event);
  return accumulator.result();
}

/** Completeness for model breakdowns summed across providers or days. */
export function buildModelCostCompleteness(models: readonly ModelBreakdown[]): CostCompleteness {
  const accumulator = new CostCompletenessAccumulator();
  for (const model of models) accumulator.add(model);
  return accumulator.result();
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
