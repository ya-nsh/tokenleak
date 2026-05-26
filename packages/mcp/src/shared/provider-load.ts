import type { DateRange, ProviderData, ProviderWarning } from '@tokenleak/core';
import type { IProvider, ProviderRegistry } from '@tokenleak/registry';

const EXPLICIT_ONLY_PROVIDERS = new Set(['synthetic']);

export interface LoadedProviderData {
  data: ProviderData[];
  warnings: ProviderWarning[];
}

export async function getAvailableProvidersForRequest(
  registry: ProviderRegistry,
  providerName?: string,
): Promise<IProvider[]> {
  const available = await registry.getAvailable();
  if (providerName) {
    return available.filter((provider) => provider.name === providerName);
  }
  return available.filter((provider) => !EXPLICIT_ONLY_PROVIDERS.has(provider.name));
}

export async function loadProviderData(
  providers: IProvider[],
  range: DateRange,
): Promise<LoadedProviderData> {
  const warnings: ProviderWarning[] = [];
  const results = await Promise.all(
    providers.map(async (provider) => {
      try {
        return await provider.load(range);
      } catch {
        warnings.push({ kind: 'provider-load', file: provider.name, count: 1 });
        return null;
      }
    }),
  );

  return {
    data: results.filter((result): result is ProviderData => result !== null),
    warnings,
  };
}

export function summarizeProviderData(data: ProviderData[]) {
  return data.map((provider) => ({
    name: provider.provider,
    displayName: provider.displayName,
    tokens: provider.totalTokens,
    cost: provider.totalCost,
    costCompleteness: provider.costCompleteness,
    warnings: provider.warnings,
  }));
}
