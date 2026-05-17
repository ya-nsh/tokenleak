import { buildAgentWasteReport, SCHEMA_VERSION } from '@tokenleak/core';
import type { UsageEvent } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';
import { loadProviderData } from '../shared/provider-load.js';

export async function handleGetAgentWaste(
  args: { days?: number; since?: string; until?: string; provider?: string; severity?: string },
  registry: ProviderRegistry,
) {
  try {
    const range = resolveRange(args);
    const available = await registry.getAvailable();
    const filtered = args.provider ? available.filter((p) => p.name === args.provider) : available;
    const { data, warnings } = await loadProviderData(filtered, range);
    const events: UsageEvent[] = data.flatMap((provider) => provider.events ?? []);
    const report = buildAgentWasteReport(data, events, range);
    const severity = args.severity ?? 'all';
    if (!['all', 'high', 'medium', 'low'].includes(severity)) {
      throw new Error('severity must be all, high, medium, or low');
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              schemaVersion: SCHEMA_VERSION,
              ...report,
              signals:
                severity === 'all'
                  ? report.signals
                  : report.signals.filter((signal) => signal.severity === severity),
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
