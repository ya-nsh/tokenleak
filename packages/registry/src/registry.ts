import type { DateRange, ProviderResult } from '@tokenleak/core';
import { DEFAULT_CONCURRENCY } from '@tokenleak/core';
import type { IProvider } from './provider';

/**
 * Central registry that holds all known providers and orchestrates
 * availability checks and parallel data loading.
 */
export class ProviderRegistry {
  private readonly providers: Map<string, IProvider> = new Map();

  /** Register a provider. Throws if a provider with the same name already exists. */
  register(provider: IProvider): void {
    if (this.providers.has(provider.name)) {
      throw new Error(
        `Provider "${provider.name}" is already registered`,
      );
    }
    this.providers.set(provider.name, provider);
  }

  /** Return all registered providers in registration order. */
  getAll(): IProvider[] {
    return [...this.providers.values()];
  }

  /** Return only providers whose data source is available on disk. */
  async getAvailable(): Promise<IProvider[]> {
    const results = await Promise.all(
      this.getAll().map(async (p) => ({
        provider: p,
        available: await p.isAvailable(),
      })),
    );
    return results.filter((r) => r.available).map((r) => r.provider);
  }

  /**
   * Load data from all available providers in parallel,
   * respecting the given concurrency limit.
   * Errors for individual providers are captured in the result
   * without aborting the remaining loads.
   */
  async loadAll(
    range: DateRange,
    concurrency: number = DEFAULT_CONCURRENCY,
  ): Promise<ProviderResult[]> {
    const available = await this.getAvailable();
    const results: ProviderResult[] = [];
    const queue = [...available];

    const runNext = async (): Promise<void> => {
      while (queue.length > 0) {
        const provider = queue.shift()!;
        try {
          const data = await provider.load(range);
          results.push({ provider: provider.name, data, error: null });
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : String(err);
          results.push({ provider: provider.name, data: null, error: message });
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, available.length) },
      () => runNext(),
    );
    await Promise.all(workers);

    return results;
  }
}
