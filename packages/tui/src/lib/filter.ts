import type { DailyUsage, ProviderData } from '@tokenleak/core';
import { getTodayLocal } from '@tokenleak/core';
import { buildTuiData, sumDailyTotals } from './data.js';
import type { TuiData } from './data.js';

/** A drill-down: only usage from this provider and/or model. */
export interface UsageFilter {
  /** Provider key, e.g. `claude-code`. */
  provider?: string;
  /** Normalised model name, e.g. `claude-opus-5-5`. */
  model?: string;
}

export function isFilterActive(filter: UsageFilter | null | undefined): filter is UsageFilter {
  return Boolean(filter && (filter.provider || filter.model));
}

/** A day reduced to one model's breakdown, or null when that model was not used. */
function dayForModel(day: DailyUsage, model: string): DailyUsage | null {
  const models = day.models.filter((entry) => entry.model === model);
  if (models.length === 0) return null;
  const sum = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'totalTokens' | 'cost') =>
    models.reduce((total, entry) => total + entry[key], 0);
  return {
    date: day.date,
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    totalTokens: sum('totalTokens'),
    cost: sum('cost'),
    models,
  };
}

/** One provider's data restricted to `model`: daily rows, events and totals. */
export function providerForModel(provider: ProviderData, model: string): ProviderData {
  const daily = provider.daily.flatMap((day) => dayForModel(day, model) ?? []);
  return {
    ...provider,
    ...sumDailyTotals(daily),
    daily,
    ...(provider.events ? { events: provider.events.filter((event) => event.model === model) } : {}),
  };
}

/**
 * The data as if only the filtered provider and/or model had been used:
 * provider totals, daily rows, events and every time window are rebuilt, so
 * every view and report reflects the drill-down. Providers left with no
 * usage are dropped.
 */
export function filterTuiData(data: TuiData, filter: UsageFilter, today: string = getTodayLocal()): TuiData {
  if (!isFilterActive(filter)) return data;
  const providers = data.providers
    .filter((provider) => !filter.provider || provider.provider === filter.provider)
    .map((provider) => (filter.model ? providerForModel(provider, filter.model) : provider))
    .filter((provider) => provider.daily.length > 0);
  return buildTuiData(providers, data.cursorSetupStatus, today);
}
