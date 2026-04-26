import {
  aggregate,
  mergeProviderData,
  SCHEMA_VERSION,
} from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';
import { loadProviderData, summarizeProviderData } from '../shared/provider-load.js';

export async function handleGetUsageSummary(
  args: { days?: number; since?: string; until?: string; provider?: string },
  registry: ProviderRegistry,
) {
  try {
    const range = resolveRange(args);
    const available = await registry.getAvailable();
    const filtered = args.provider
      ? available.filter((p) => p.name === args.provider)
      : available;

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
                providers: [],
                aggregated: null,
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
    const stats = aggregate(merged, range.until);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              schemaVersion: SCHEMA_VERSION,
              dateRange: range,
              aggregated: stats,
              providers: summarizeProviderData(data),
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
