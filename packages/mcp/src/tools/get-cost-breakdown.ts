import { aggregate, mergeProviderData } from '@tokenleak/core';
import type { ProviderData } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';

export async function handleGetCostBreakdown(
  args: { days?: number; since?: string; until?: string },
  registry: ProviderRegistry,
) {
  try {
    const range = resolveRange(args);
    const available = await registry.getAvailable();

    const results = await Promise.all(
      available.map((p) => p.load(range).catch(() => null)),
    );
    const data = results.filter((r): r is ProviderData => r !== null);

    if (data.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { dateRange: range, models: [], message: 'No provider data found.' },
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
              dateRange: range,
              totalCost: stats.totalCost,
              models: stats.topModels,
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
