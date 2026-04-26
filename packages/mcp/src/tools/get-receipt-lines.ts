import { buildReceipt, SCHEMA_VERSION } from '@tokenleak/core';
import type { UsageEvent } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';
import { loadProviderData } from '../shared/provider-load.js';

export async function handleGetReceiptLines(
  args: { days?: number; since?: string; until?: string; provider?: string; topLines?: number },
  registry: ProviderRegistry,
) {
  try {
    const range = resolveRange(args);
    const available = await registry.getAvailable();
    const filtered = args.provider
      ? available.filter((p) => p.name === args.provider)
      : available;

    const { data, warnings } = await loadProviderData(filtered, range);

    const events: UsageEvent[] = [];
    for (const provider of data) {
      if (provider.events) events.push(...provider.events);
    }

    if (
      args.topLines !== undefined &&
      (!Number.isInteger(args.topLines) || args.topLines <= 0)
    ) {
      throw new Error('topLines must be a positive integer');
    }

    const receipt = buildReceipt(
      events,
      range,
      typeof args.topLines === 'number' ? { topLines: args.topLines } : {},
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              schemaVersion: SCHEMA_VERSION,
              dateRange: range,
              receipt,
              warnings,
              note:
                events.length > 0 && receipt.lines.length === 0
                  ? 'No events carried captured prompts. Prompt capture currently only works for Claude Code logs.'
                  : undefined,
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
