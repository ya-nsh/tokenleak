import type { DateRange, ProviderData, ProviderWarning } from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';

export interface LoadedProviderData {
  data: ProviderData[];
  warnings: ProviderWarning[];
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
