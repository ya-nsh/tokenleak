import {
  aggregate,
  mergeProviderData,
  buildCompareOutput,
  computePreviousPeriod,
  getTodayLocal,
  inclusiveDaySpan,
  shiftDateStringLocal,
} from '@tokenleak/core';
import type { DateRange, ProviderData } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';

async function loadAndAggregate(
  providers: Awaited<ReturnType<ProviderRegistry['getAvailable']>>,
  range: DateRange,
) {
  const results = await Promise.all(
    providers.map((p) => p.load(range).catch(() => null)),
  );
  const data = results.filter((r): r is ProviderData => r !== null);
  const merged = mergeProviderData(data);
  const stats = aggregate(merged, range.until);
  return { data, stats };
}

export async function handleComparePeriods(
  args: {
    current_since: string;
    current_until?: string;
    previous_since?: string;
    previous_until?: string;
  },
  registry: ProviderRegistry,
) {
  try {
    const currentRange: DateRange = {
      since: args.current_since,
      until: args.current_until ?? getTodayLocal(),
    };

    let previousRange: DateRange;
    if (args.previous_since && args.previous_until) {
      previousRange = { since: args.previous_since, until: args.previous_until };
    } else if (args.previous_since) {
      previousRange = { since: args.previous_since, until: currentRange.since };
    } else if (args.previous_until) {
      const currentDays = inclusiveDaySpan(currentRange.since, currentRange.until);
      previousRange = {
        since: shiftDateStringLocal(args.previous_until, -(currentDays - 1)),
        until: args.previous_until,
      };
    } else {
      previousRange = computePreviousPeriod(currentRange);
    }

    const available = await registry.getAvailable();

    const [currentResult, previousResult] = await Promise.all([
      loadAndAggregate(available, currentRange),
      loadAndAggregate(available, previousRange),
    ]);

    const compareOutput = buildCompareOutput(
      { range: previousRange, stats: previousResult.stats },
      { range: currentRange, stats: currentResult.stats },
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(compareOutput, null, 2),
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
