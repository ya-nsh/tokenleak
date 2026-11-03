import { buildSavingsReport, filterBySeverity, SCHEMA_VERSION } from '@tokenleak/core';
import type { UsageEvent } from '@tokenleak/core';
import { buildPricingTable } from '@tokenleak/registry';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';
import { getAvailableProvidersForRequest, loadProviderData } from '../shared/provider-load.js';

const SEVERITIES = ['all', 'high', 'medium', 'low'] as const;
type SeverityFilter = (typeof SEVERITIES)[number];

function isSeverityFilter(value: string): value is SeverityFilter {
  return (SEVERITIES as readonly string[]).includes(value);
}

/**
 * The savings report behind `get_efficiency_advice` and `get_agent_waste`:
 * routing, cache, session and spend findings ranked by severity and savings.
 */
export async function handleGetSavings(
  args: { days?: number; since?: string; until?: string; provider?: string; severity?: string },
  registry: ProviderRegistry,
) {
  try {
    const severity = args.severity ?? 'all';
    if (!isSeverityFilter(severity)) {
      throw new Error('severity must be all, high, medium, or low');
    }
    const range = resolveRange(args);
    const providers = await getAvailableProvidersForRequest(registry, args.provider);
    const { data, warnings } = await loadProviderData(providers, range);
    const events: UsageEvent[] = data.flatMap((provider) => provider.events ?? []);
    const report = buildSavingsReport({
      providers: data,
      events,
      dateRange: range,
      pricing: buildPricingTable(events.map((event) => event.model)),
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              schemaVersion: SCHEMA_VERSION,
              ...filterBySeverity(report, severity),
              providerWarnings: warnings,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text' as const, text: message }] };
  }
}
