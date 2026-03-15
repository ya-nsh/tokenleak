import {
  aggregate,
  mergeProviderData,
  SCHEMA_VERSION,
} from '@tokenleak/core';
import type { ProviderData } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';

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

    const results = await Promise.all(
      filtered.map((p) => p.load(range).catch(() => null)),
    );
    const data = results.filter((r): r is ProviderData => r !== null);

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
              providers: data.map((d) => ({
                name: d.provider,
                displayName: d.displayName,
                tokens: d.totalTokens,
                cost: d.totalCost,
              })),
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
