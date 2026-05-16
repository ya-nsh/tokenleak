import {
  SCHEMA_VERSION,
  aggregate,
  buildAgentBehaviorDiffReport,
  buildAgentWasteReport,
  mergeProviderData,
  buildCompareOutput,
  buildMoreStats,
  buildRoutingSimulationReport,
  computePreviousPeriod,
  parseCompareRange,
  mergeCostCompleteness,
} from '@tokenleak/core';
import type {
  BehaviorCohortSelector,
  CompareOutput,
  DateRange,
  ProviderData,
  TokenleakOutput,
  UsageEvent,
} from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import { MODEL_PRICING } from '@tokenleak/registry';
import { TokenleakError } from './errors.js';

export interface LoadTokenleakDataOptions {
  includeOptimization?: boolean;
}

/**
 * Load provider data for a date range, merge, aggregate, and build
 * a complete TokenleakOutput. Always computes MoreStats.
 */
export async function loadTokenleakData(
  providers: IProvider[],
  range: DateRange,
  options: LoadTokenleakDataOptions = {},
): Promise<TokenleakOutput> {
  const { data: providerDataList, stats } = await loadAndAggregate(providers, range);
  const events = providerDataList.flatMap((provider) => provider.events ?? []);

  return {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange: range,
    providers: providerDataList,
    aggregated: stats,
    more: buildMoreStats(providerDataList, range),
    optimization: options.includeOptimization
      ? buildDefaultOptimization(providerDataList, events, range)
      : undefined,
  };
}

function defaultBehaviorSelectors(
  providers: ProviderData[],
  events: UsageEvent[],
  range: DateRange,
): [BehaviorCohortSelector, BehaviorCohortSelector] {
  const topProviders = providers
    .map((provider) => ({ provider: provider.provider, label: provider.displayName, tokens: provider.totalTokens }))
    .filter((provider) => provider.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
  if (topProviders.length >= 2) {
    return [
      { label: topProviders[0]!.label, dimension: 'provider', provider: topProviders[0]!.provider },
      { label: topProviders[1]!.label, dimension: 'provider', provider: topProviders[1]!.provider },
    ];
  }

  const modelTokens = new Map<string, number>();
  for (const event of events) {
    modelTokens.set(event.model, (modelTokens.get(event.model) ?? 0) + event.totalTokens);
  }
  const topModels = [...modelTokens.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (topModels.length >= 2) {
    return [
      { label: topModels[0]![0], dimension: 'model', model: topModels[0]![0] },
      { label: topModels[1]![0], dimension: 'model', model: topModels[1]![0] },
    ];
  }

  return [
    { label: 'Current window', dimension: 'date-range', dateRange: range },
    { label: 'Current window', dimension: 'date-range', dateRange: range },
  ];
}

export function buildDefaultOptimization(
  providers: ProviderData[],
  events: UsageEvent[],
  range: DateRange,
): NonNullable<TokenleakOutput['optimization']> {
  const [baseline, comparison] = defaultBehaviorSelectors(providers, events, range);
  return {
    routingSimulation: buildRoutingSimulationReport(events, range, MODEL_PRICING),
    agentWaste: buildAgentWasteReport(providers, events, range),
    behaviorDiff: buildAgentBehaviorDiffReport(events, range, baseline, comparison),
  };
}

function resolveCompareRange(compareStr: string, currentRange: DateRange): DateRange {
  if (compareStr === 'auto' || compareStr === 'true' || compareStr === '') {
    return computePreviousPeriod(currentRange);
  }

  const parsed = parseCompareRange(compareStr);
  if (!parsed) {
    throw new TokenleakError(
      `Invalid --compare format: "${compareStr}". Use YYYY-MM-DD..YYYY-MM-DD or "auto".`,
    );
  }

  return parsed;
}

async function loadAndAggregate(
  providers: IProvider[],
  range: DateRange,
  allowEmpty: boolean = false,
): Promise<{ data: ProviderData[]; stats: ReturnType<typeof aggregate> }> {
  const results = await Promise.all(
    providers.map(async (p) => {
      try {
        return { data: await p.load(range), failed: false };
      } catch {
        const data: ProviderData = {
          provider: p.name,
          displayName: p.displayName,
          daily: [],
          totalTokens: 0,
          totalCost: 0,
          colors: p.colors,
          events: [],
          warnings: [{ kind: 'provider-load', file: p.name, count: 1 }],
          costCompleteness: {
            status: 'unknown',
            totalTokens: 0,
            pricedTokens: 0,
            unpricedTokens: 0,
            unknownModels: [],
          },
        };
        return { data, failed: true };
      }
    }),
  );

  const providerDataList = results.map((result) => result.data);
  const successfulProviderCount = results.filter((result) => !result.failed).length;

  if (!allowEmpty && successfulProviderCount === 0) {
    throw new TokenleakError('No provider data found');
  }

  const mergedDaily = mergeProviderData(providerDataList);
  const stats = aggregate(mergedDaily, range.until);
  stats.costCompleteness = mergeCostCompleteness(providerDataList);

  return { data: providerDataList, stats };
}

export interface LoadedCompareTokenleakData {
  output: TokenleakOutput;
  compareOutput: CompareOutput;
  currentData: ProviderData[];
  previousData: ProviderData[];
}

export async function loadCompareTokenleakData(
  providers: IProvider[],
  currentRange: DateRange,
  compareStr: string,
  options: LoadTokenleakDataOptions = {},
): Promise<LoadedCompareTokenleakData> {
  const previousRange = resolveCompareRange(compareStr, currentRange);
  const [currentResult, previousResult] = await Promise.all([
    loadAndAggregate(providers, currentRange),
    loadAndAggregate(providers, previousRange, true),
  ]);

  const compareOutput = buildCompareOutput(
    { range: previousRange, stats: previousResult.stats },
    { range: currentRange, stats: currentResult.stats },
  );

  return {
    compareOutput,
    currentData: currentResult.data,
    previousData: previousResult.data,
    output: {
      schemaVersion: SCHEMA_VERSION,
      generated: new Date().toISOString(),
      dateRange: currentRange,
      providers: currentResult.data,
      aggregated: currentResult.stats,
      more: buildMoreStats(currentResult.data, currentRange, {
        previousRange,
        previousProviders: previousResult.data,
        previousStats: compareOutput.periodA.stats,
        deltas: compareOutput.deltas,
      }),
      optimization: options.includeOptimization
        ? buildDefaultOptimization(
            currentResult.data,
            currentResult.data.flatMap((provider) => provider.events ?? []),
            currentRange,
          )
        : undefined,
    },
  };
}
