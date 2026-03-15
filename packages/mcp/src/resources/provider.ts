import type { ProviderData } from '@tokenleak/core';
import type { ProviderRegistry } from '@tokenleak/registry';
import { resolveRange } from '../shared/date-range.js';

export async function handleProvider(
  name: string,
  registry: ProviderRegistry,
): Promise<string> {
  const range = resolveRange({});
  const all = registry.getAll();
  const provider = all.find((p) => p.name === name);

  if (!provider) {
    return JSON.stringify(
      { error: `Provider "${name}" not found.` },
      null,
      2,
    );
  }

  const available = await provider.isAvailable();
  if (!available) {
    return JSON.stringify(
      {
        provider: name,
        displayName: provider.displayName,
        available: false,
        message: `Provider "${name}" data source is not available.`,
      },
      null,
      2,
    );
  }

  try {
    const data: ProviderData = await provider.load(range);
    return JSON.stringify(data, null, 2);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify(
      { provider: name, error: message },
      null,
      2,
    );
  }
}
