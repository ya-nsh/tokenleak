import { buildRoutingSimulationReport, SCHEMA_VERSION } from '@tokenleak/core';
import type { UsageEvent } from '@tokenleak/core';
import { MODEL_PRICING, type ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';
import { loadProviderData } from '../shared/provider-load.js';

export async function handleGetRoutingSimulation(
  args: { days?: number; since?: string; until?: string; provider?: string; strategy?: string },
  registry: ProviderRegistry,
) {
  try {
    const range = resolveRange(args);
    const available = await registry.getAvailable();
    const filtered = args.provider ? available.filter((p) => p.name === args.provider) : available;
    const { data, warnings } = await loadProviderData(filtered, range);
    const events: UsageEvent[] = data.flatMap((provider) => provider.events ?? []);
    const report = buildRoutingSimulationReport(events, range, MODEL_PRICING, {
      strategy: args.strategy ?? 'conservative',
    });

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
