import { aggregate, mergeProviderData } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';
import { getAvailableProvidersForRequest, loadProviderData } from '../shared/provider-load.js';

export async function handleGetCostBreakdown(
  args: { days?: number; since?: string; until?: string },
  registry: ProviderRegistry,
) {
  try {
    const range = resolveRange(args);
    const available = await getAvailableProvidersForRequest(registry);

    const { data, warnings } = await loadProviderData(available, range);

    if (data.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { dateRange: range, models: [], warnings, message: 'No provider data found.' },
              null,
              2,
            ),
          },
        ],
      };
    }

    const merged = mergeProviderData(data);
    const stats = aggregate(merged, range.until, range);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              dateRange: range,
              totalCost: stats.totalCost,
              costCompleteness: stats.costCompleteness,
              models: stats.topModels,
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
