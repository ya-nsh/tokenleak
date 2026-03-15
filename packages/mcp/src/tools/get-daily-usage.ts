import { mergeProviderData } from '@tokenleak/core';
import type { ProviderData } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';

const DEFAULT_DAILY_DAYS = 14;

export async function handleGetDailyUsage(
  args: { days?: number; since?: string; until?: string; provider?: string },
  registry: ProviderRegistry,
) {
  try {
    const range = resolveRange(args, DEFAULT_DAILY_DAYS);
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
              { dateRange: range, daily: [], message: 'No provider data found.' },
              null,
              2,
            ),
          },
        ],
      };
    }

    const merged = mergeProviderData(data);

    const daily = merged.map((d) => ({
      date: d.date,
      tokens: d.totalTokens,
      cost: d.cost,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      cacheReadTokens: d.cacheReadTokens,
      cacheWriteTokens: d.cacheWriteTokens,
    }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ dateRange: range, daily }, null, 2),
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
