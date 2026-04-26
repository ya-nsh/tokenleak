import type {
  AggregatedStats,
  AdvisorReport,
  CompareOutput,
  DailyUsage,
  DateRange,
  ExplainReport,
  FocusReport,
  MoreStats,
  NutritionOutcomeSignal,
  NutritionReport,
  ProviderData,
  Receipt,
  ReceiptLine,
  ReplayReport,
  TokenleakOutput,
  UsageEvent,
  WasteReport,
} from '@tokenleak/core';
import {
  aggregate,
  analyzeEfficiency,
  buildExplainReport,
  buildFocusReport,
  buildMoreStats,
  buildNutritionReport,
  buildReceipt,
  buildReplayReport,
  buildWasteReport,
  collectGitOutcomeSignals,
  compareRanges,
  dayOfWeekBreakdown,
  mergeProviderData,
  SCHEMA_VERSION,
} from '@tokenleak/core';
import {
  ProviderRegistry,
  ClaudeCodeProvider,
  CodexProvider,
  CursorProvider,
  OpenCodeProvider,
  PiProvider,
  MODEL_PRICING,
  resolveCursorSetupStatus,
  type CursorSetupStatus,
} from '@tokenleak/registry';
import type { AppState } from './state.js';
import { WINDOW_DAYS } from './state.js';

export interface TimeWindowData {
  label: string;
  days: number;
  stats: AggregatedStats;
  dateRange: DateRange;
  nutritionOutcomeSignals: NutritionOutcomeSignal[];
}

export interface TuiData {
  providers: ProviderData[];
  allTimeStats: AggregatedStats;
  windows: TimeWindowData[];
  dateRange: DateRange;
  mergedDaily: DailyUsage[];
  cursorSetupStatus: CursorSetupStatus;
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
  const cursorSetupStatus = await resolveCursorSetupStatus({ attemptSync: true });
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
      mergedDaily: [],
      cursorSetupStatus,
    };
  }

  const allMerged = mergeProviderData(providers);
  const allTimeStats = aggregate(allMerged, today);

  // Compute time-window aggregations by filtering daily data
  const windowConfigs = [
    { label: '1D', days: 1 },
    { label: '7D', days: 7 },
    { label: '30D', days: 30 },
    { label: '90D', days: 90 },
  ];

  const windows: TimeWindowData[] = [];

  for (const { label, days } of windowConfigs) {
    const since = daysAgoStr(days - 1); // trailing N days including today
    const dateRange: DateRange = { since, until: today };
    const filtered = allMerged.filter((d) => d.date >= since && d.date <= today);
    const stats = aggregate(filtered, today);
    const events = providers.flatMap((provider) =>
      (provider.events ?? []).filter((event) => event.date >= dateRange.since && event.date <= dateRange.until),
    );
    const nutritionOutcomeSignals = await collectGitOutcomeSignals(events, dateRange);
    windows.push({ label, days, stats, dateRange, nutritionOutcomeSignals });
  }

  // Add all-time window
  const allEvents = providers.flatMap((provider) => provider.events ?? []);
  const allNutritionOutcomeSignals = await collectGitOutcomeSignals(allEvents, allTimeRange);
  windows.push({
    label: 'ALL',
    days: 0,
    stats: allTimeStats,
    dateRange: allTimeRange,
    nutritionOutcomeSignals: allNutritionOutcomeSignals,
  });

  return {
    providers,
    allTimeStats,
    windows,
    dateRange: allTimeRange,
    mergedDaily: allMerged,
    cursorSetupStatus,
  };
}

/** Get daily usage data filtered to a specific time window */
export function getDailyForWindow(data: TuiData, windowIndex: number): DailyUsage[] {
  const today = todayStr();
  const days = WINDOW_DAYS[windowIndex];

  if (days === undefined || days === 0) {
    return data.mergedDaily;
  }

  const since = daysAgoStr(days - 1); // trailing N days including today
  return data.mergedDaily.filter((d) => d.date >= since && d.date <= today);
}

/** Build window-scoped date range and providers for the selected window */
function getScopedWindowData(state: AppState): { windowRange: DateRange; scopedProviders: ProviderData[] } | null {
  if (!state.data || state.data.windows.length === 0) return null;
  const days = WINDOW_DAYS[state.selectedWindowIndex];
  const today = todayStr();

  const windowRange: DateRange = days && days > 0
    ? { since: daysAgoStr(days - 1), until: today }
    : state.data.dateRange;

  const scopedProviders: ProviderData[] = state.data.providers.map((p) => {
    if (!days || !p.events) return p;
    const filteredEvents = p.events.filter((e) => e.date >= windowRange.since && e.date <= windowRange.until);
    const filteredDaily = p.daily?.filter((d) => d.date >= windowRange.since && d.date <= windowRange.until);
    return { ...p, events: filteredEvents, daily: filteredDaily };
  });

  return { windowRange, scopedProviders };
}

/** Lazily compute and cache the AdvisorReport (window-dependent) */
export function ensureAdvisorReport(state: AppState): AdvisorReport | null {
  if (!state.data || state.data.windows.length === 0) return null;
  if (state.cachedAdvisorReport) return state.cachedAdvisorReport;

  const windowStats = state.data.windows[state.selectedWindowIndex]?.stats;
  if (!windowStats) return null;

  const scoped = getScopedWindowData(state);
  if (!scoped) return null;

  const output: TokenleakOutput = {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange: scoped.windowRange,
    providers: scoped.scopedProviders,
    aggregated: windowStats,
  };

  const report = analyzeEfficiency(output, MODEL_PRICING);
  state.cachedAdvisorReport = report;
  return report;
}

/** Lazily compute and cache Waste taxonomy findings for the Advisor view */
export function ensureWasteReport(state: AppState): WasteReport | null {
  if (!state.data || state.data.windows.length === 0) return null;
  if (state.cachedWasteReport) return state.cachedWasteReport;

  const windowStats = state.data.windows[state.selectedWindowIndex]?.stats;
  if (!windowStats) return null;

  const scoped = getScopedWindowData(state);
  if (!scoped) return null;

  const output: TokenleakOutput = {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange: scoped.windowRange,
    providers: scoped.scopedProviders,
    aggregated: windowStats,
    more: ensureMoreStats(state),
  };

  const report = buildWasteReport(output);
  state.cachedWasteReport = report;
  return report;
}

/** Lazily compute and cache the FocusReport (window-dependent — filters events by date) */
export function ensureFocusReport(state: AppState): FocusReport | null {
  if (!state.data) return null;
  if (state.cachedFocusReport) return state.cachedFocusReport;

  const allEvents = state.data.providers.flatMap((p) => p.events ?? []);

  // Filter events to the selected time window
  const days = WINDOW_DAYS[state.selectedWindowIndex];
  let filtered = allEvents;
  if (days && days > 0) {
    const since = daysAgoStr(days - 1);
    const today = todayStr();
    filtered = allEvents.filter((e) => e.date >= since && e.date <= today);
  }

  const report = buildFocusReport(filtered);
  state.cachedFocusReport = report;
  return report;
}

/** Lazily compute and cache the NutritionReport (window-dependent) */
export function ensureNutritionReport(state: AppState): NutritionReport | null {
  if (!state.data || state.data.windows.length === 0) return null;
  if (state.cachedNutritionReport) return state.cachedNutritionReport;

  const window = state.data.windows[state.selectedWindowIndex];
  const scoped = getScopedWindowData(state);
  if (!window || !scoped) return null;

  const events = scoped.scopedProviders.flatMap((provider) => provider.events ?? []);
  const report = buildNutritionReport(events, window.nutritionOutcomeSignals, window.dateRange);
  state.cachedNutritionReport = report;
  return report;
}

/** Lazily compute and cache the ExplainReport (date-dependent) */
export function ensureExplainReport(state: AppState): ExplainReport | null {
  if (!state.data) return null;
  if (state.cachedExplainReport && state.cachedExplainReport.date === state.explainDate) {
    return state.cachedExplainReport;
  }

  // Default to peak day from current window
  if (!state.explainDate) {
    const windowStats = state.data.windows[state.selectedWindowIndex]?.stats;
    state.explainDate = windowStats?.peakDay?.date ?? todayStr();
  }

  const report = buildExplainReport(state.data.providers, state.explainDate);
  state.cachedExplainReport = report;
  return report;
}

/** Lazily compute and cache CompareOutput (window-dependent) */
export function ensureCompareOutput(state: AppState): CompareOutput | null {
  if (!state.data) return null;
  if (state.cachedCompareOutput) return state.cachedCompareOutput;

  const days = WINDOW_DAYS[state.selectedWindowIndex] || 365;
  const today = todayStr();
  // rangeB = current period (trailing N days including today)
  // rangeA = previous period of equal length (N days ending the day before rangeB starts)
  const rangeB: DateRange = { since: daysAgoStr(days - 1), until: today };
  const rangeA: DateRange = { since: daysAgoStr(days * 2 - 1), until: daysAgoStr(days) };
  const output = compareRanges(state.data.mergedDaily, rangeA, rangeB);
  state.cachedCompareOutput = output;
  return output;
}

/** Lazily compute and cache MoreStats (window-dependent) */
export function ensureMoreStats(state: AppState): MoreStats | null {
  if (!state.data || state.data.windows.length === 0) return null;
  if (state.cachedMoreStats) return state.cachedMoreStats;

  const scoped = getScopedWindowData(state);
  if (!scoped) return null;

  const more = buildMoreStats(scoped.scopedProviders, scoped.windowRange);
  state.cachedMoreStats = more;
  return more;
}

/**
 * Apply the current sort + filter to a receipt's lines. Returned array is a
 * shallow copy so the caller can safely mutate or slice. The subtotal/total
 * summary is not recomputed — filters only affect which rows are displayed.
 */
export function deriveReceiptLines(
  receipt: Receipt,
  sortMode: AppState['receiptsSortMode'],
  filter: AppState['receiptsCategoryFilter'],
): ReceiptLine[] {
  const filtered = filter === null ? receipt.lines : receipt.lines.filter((l) => l.category === filter);
  const sorted = [...filtered];
  if (sortMode === 'qty') {
    sorted.sort((a, b) => b.quantity - a.quantity);
  } else if (sortMode === 'alpha') {
    sorted.sort((a, b) => a.description.localeCompare(b.description));
  } else {
    sorted.sort((a, b) => b.totalCost - a.totalCost);
  }
  return sorted;
}

/** Lazily compute and cache the Receipt (window-dependent) */
export function ensureReceipt(state: AppState): Receipt | null {
  if (!state.data) return null;
  if (state.cachedReceipt) return state.cachedReceipt;

  const allEvents: UsageEvent[] = state.data.providers.flatMap((p) => p.events ?? []);
  const days = WINDOW_DAYS[state.selectedWindowIndex];
  let filtered = allEvents;
  let range: DateRange;
  if (days && days > 0) {
    const since = daysAgoStr(days - 1);
    const until = todayStr();
    filtered = allEvents.filter((e) => e.date >= since && e.date <= until);
    range = { since, until };
  } else {
    range = state.data.dateRange;
  }

  const receipt = buildReceipt(filtered, range);
  state.cachedReceipt = receipt;
  return receipt;
}

/** Lazily compute and cache the ReplayReport (date- and window-dependent) */
export function ensureReplayReport(state: AppState): ReplayReport | null {
  if (!state.data) return null;
  if (state.cachedReplayReport && state.cachedReplayReport.date === state.replayDate) {
    return state.cachedReplayReport;
  }

  if (!state.replayDate) {
    state.replayDate = todayStr();
  }

  const scoped = getScopedWindowData(state);
  if (!scoped) return null;

  const report = buildReplayReport(scoped.scopedProviders, state.replayDate);
  state.cachedReplayReport = report;
  return report;
}

/** Get day-of-week breakdown for the current window's daily data */
export function getDayOfWeekForWindow(state: AppState) {
  if (!state.data) return [];
  const daily = getDailyForWindow(state.data, state.selectedWindowIndex);
  return dayOfWeekBreakdown(daily);
}
