import {
  SCHEMA_VERSION,
  aggregate,
  mergeProviderData,
  buildMoreStats,
} from '@tokenleak/core';
import type {
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

  if (providerDataList.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  const mergedDaily = mergeProviderData(providerDataList);
  const stats = aggregate(mergedDaily, range.until);

  return {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange: range,
    providers: providerDataList,
    aggregated: stats,
    more: buildMoreStats(providerDataList, range),
  };
}
