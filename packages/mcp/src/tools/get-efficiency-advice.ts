import {
  aggregate,
  analyzeEfficiency,
  buildMoreStats,
  mergeProviderData,
  SCHEMA_VERSION,
} from '@tokenleak/core';
import { MODEL_PRICING } from '@tokenleak/registry';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';
import { getAvailableProvidersForRequest, loadProviderData } from '../shared/provider-load.js';

export async function handleGetEfficiencyAdvice(
  args: { days?: number; since?: string; until?: string; provider?: string },
  registry: ProviderRegistry,
) {
  try {
    const range = resolveRange(args);
    const filtered = await getAvailableProvidersForRequest(registry, args.provider);

    const { data, warnings } = await loadProviderData(filtered, range);

    if (data.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                schemaVersion: SCHEMA_VERSION,
                dateRange: range,
                recommendations: [],
                warnings,
                message: 'No provider data found for the given range.',
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const merged = mergeProviderData(data);
    const stats = aggregate(merged, range.until, range);
    const more = buildMoreStats(data, range);

    const output = {
      schemaVersion: SCHEMA_VERSION,
      generated: new Date().toISOString(),
      dateRange: range,
      providers: data,
      aggregated: stats,
      more,
    };

    const report = analyzeEfficiency(output, MODEL_PRICING);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              ...report,
              costCompleteness: stats.costCompleteness,
              warnings,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: 'text' as const, text: message }],
    };
  }
}
