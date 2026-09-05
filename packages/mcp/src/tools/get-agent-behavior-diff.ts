import { buildAgentBehaviorDiffReport, SCHEMA_VERSION } from '@tokenleak/core';
import type { BehaviorCohortSelector, UsageEvent } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';
import { loadProviderData } from '../shared/provider-load.js';

export async function handleGetAgentBehaviorDiff(
  args: {
    days?: number;
    since?: string;
    until?: string;
    baseline: BehaviorCohortSelector;
    comparison: BehaviorCohortSelector;
  },
  registry: ProviderRegistry,
) {
  try {
    const range = resolveRange(args);
    const available = await registry.getAvailable();
    const { data, warnings } = await loadProviderData(available, range);
    const events: UsageEvent[] = data.flatMap((provider) => provider.events ?? []);
    const report = buildAgentBehaviorDiffReport(events, range, args.baseline, args.comparison);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...report, providerWarnings: warnings }, null, 2),
        },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text' as const, text: message }] };
  }
}
