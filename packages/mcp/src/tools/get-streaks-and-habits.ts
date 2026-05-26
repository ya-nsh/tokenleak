import { aggregate, mergeProviderData, buildMoreStats } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';
import { getAvailableProvidersForRequest, loadProviderData } from '../shared/provider-load.js';

const DEFAULT_HABITS_DAYS = 90;

export async function handleGetStreaksAndHabits(
  args: { days?: number; since?: string; until?: string },
  registry: ProviderRegistry,
) {
  try {
    const range = resolveRange(args, DEFAULT_HABITS_DAYS);
    const available = await getAvailableProvidersForRequest(registry);

    const { data, warnings } = await loadProviderData(available, range);

    if (data.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { dateRange: range, warnings, message: 'No provider data found.' },
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

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              dateRange: range,
              currentStreak: stats.currentStreak,
              longestStreak: stats.longestStreak,
              activeDays: stats.activeDays,
              totalDays: stats.totalDays,
              peakDay: stats.peakDay,
              dayOfWeek: stats.dayOfWeek,
              sessionMetrics: more.sessionMetrics,
              hourOfDay: more.hourOfDay,
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
