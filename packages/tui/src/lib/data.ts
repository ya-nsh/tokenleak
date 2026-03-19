import type {
  AggregatedStats,
  DateRange,
  ProviderData,
} from '@tokenleak/core';
import { aggregate, mergeProviderData } from '@tokenleak/core';
import {
  ProviderRegistry,
  ClaudeCodeProvider,
  CodexProvider,
  CursorProvider,
  OpenCodeProvider,
  PiProvider,
} from '@tokenleak/registry';

export interface TimeWindowData {
  label: string;
  days: number;
  stats: AggregatedStats;
}

export interface TuiData {
  providers: ProviderData[];
  allTimeStats: AggregatedStats;
  windows: TimeWindowData[];
  dateRange: DateRange;
}

function todayStr(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Create and populate the provider registry with all known providers */
function createRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new ClaudeCodeProvider());
  registry.register(new CodexProvider());
  registry.register(new CursorProvider());
  registry.register(new OpenCodeProvider());
  registry.register(new PiProvider());
  return registry;
}

/** Load all provider data and compute aggregations for multiple time windows */
export async function loadAllData(): Promise<TuiData> {
  const registry = createRegistry();
  const today = todayStr();

  // Load all-time data (use a very wide range)
  const allTimeRange: DateRange = { since: '2020-01-01', until: today };
  const results = await registry.loadAll(allTimeRange);

  const providers: ProviderData[] = results
    .filter((r) => r.data !== null)
    .map((r) => r.data as ProviderData);

  if (providers.length === 0) {
    // Return empty data structure
    const emptyDaily = mergeProviderData([]);
    const emptyStats = aggregate(emptyDaily, today);
    return {
      providers: [],
      allTimeStats: emptyStats,
      windows: [],
      dateRange: allTimeRange,
    };
  }

  const allMerged = mergeProviderData(providers);
  const allTimeStats = aggregate(allMerged, today);

  // Compute time-window aggregations by filtering daily data
  const windowConfigs = [
    { label: '7D', days: 7 },
    { label: '30D', days: 30 },
    { label: '90D', days: 90 },
  ];

  const windows: TimeWindowData[] = windowConfigs.map(({ label, days }) => {
    const since = daysAgoStr(days);
    const filtered = allMerged.filter((d) => d.date >= since && d.date <= today);
    const stats = aggregate(filtered, today);
    return { label, days, stats };
  });

  // Add all-time window
  windows.push({ label: 'ALL', days: 0, stats: allTimeStats });

  return {
    providers,
    allTimeStats,
    windows,
    dateRange: allTimeRange,
  };
}
