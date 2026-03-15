import {
  aggregate,
  analyzeEfficiency,
  buildMoreStats,
  mergeProviderData,
  SCHEMA_VERSION,
} from '@tokenleak/core';
import type { ProviderData } from '@tokenleak/core';
import { MODEL_PRICING } from '@tokenleak/registry';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';

export async function handleGetEfficiencyAdvice(
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
                recommendations: [],
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
          text: JSON.stringify(report, null, 2),
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
