import {
  SCHEMA_VERSION,
  aggregate,
  mergeProviderData,
  buildMoreStats,
} from '@tokenleak/core';
import type { ProviderData } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';

export async function handleOverview(registry: ProviderRegistry): Promise<string> {
  const range = resolveRange({});
  const available = await registry.getAvailable();

  const results = await Promise.all(
    available.map((p) => p.load(range).catch(() => null)),
  );
  const data = results.filter((r): r is ProviderData => r !== null);

  if (data.length === 0) {
    return JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        generated: new Date().toISOString(),
        dateRange: range,
        providers: [],
        aggregated: null,
        more: null,
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
    },
    null,
    2,
  );
}
