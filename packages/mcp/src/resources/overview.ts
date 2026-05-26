import {
  SCHEMA_VERSION,
  aggregate,
  mergeProviderData,
  buildMoreStats,
} from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';
import { getAvailableProvidersForRequest, loadProviderData } from '../shared/provider-load.js';

export async function handleOverview(registry: ProviderRegistry): Promise<string> {
  const range = resolveRange({});
  const available = await getAvailableProvidersForRequest(registry);

  const { data, warnings } = await loadProviderData(available, range);

  if (data.length === 0) {
    return JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        generated: new Date().toISOString(),
        dateRange: range,
        providers: [],
        aggregated: null,
        more: null,
        warnings,
      },
      null,
      2,
    );
  }

  const merged = mergeProviderData(data);
  const stats = aggregate(merged, range.until);

  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      generated: new Date().toISOString(),
      dateRange: range,
      providers: data,
      aggregated: stats,
      more: buildMoreStats(data, range),
      warnings,
    },
    null,
    2,
  );
}
