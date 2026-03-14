import {
  SCHEMA_VERSION,
  aggregate,
  mergeProviderData,
  buildCompareOutput,
  buildMoreStats,
  computePreviousPeriod,
  parseCompareRange,
} from '@tokenleak/core';
import type {
  CompareOutput,
  DateRange,
  ProviderData,
  TokenleakOutput,
} from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import { TokenleakError } from './errors.js';

/**
 * Load provider data for a date range, merge, aggregate, and build
 * a complete TokenleakOutput. Always computes MoreStats.
 */
export async function loadTokenleakData(
  providers: IProvider[],
  range: DateRange,
): Promise<TokenleakOutput> {
  const { data: providerDataList, stats } = await loadAndAggregate(providers, range);

  return {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange: range,
    providers: providerDataList,
    aggregated: stats,
    more: buildMoreStats(providerDataList, range),
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
        return await p.load(range);
      } catch {
        return null;
      }
    }),
  );

  const providerDataList: ProviderData[] = results.filter(
    (r): r is ProviderData => r !== null,
  );

  if (!allowEmpty && providerDataList.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  const mergedDaily = mergeProviderData(providerDataList);
  const stats = aggregate(mergedDaily, range.until);

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
): Promise<LoadedCompareTokenleakData> {
  const previousRange = resolveCompareRange(compareStr, currentRange);
  const [currentResult, previousResult] = await Promise.all([
    loadAndAggregate(providers, currentRange),
    loadAndAggregate(providers, previousRange, true),
  ]);

  const compareOutput = buildCompareOutput(
    { range: currentRange, stats: currentResult.stats },
    { range: previousRange, stats: previousResult.stats },
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
        previousStats: compareOutput.periodB.stats,
        deltas: compareOutput.deltas,
      }),
    },
  };
}
