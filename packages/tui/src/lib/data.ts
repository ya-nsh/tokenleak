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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

const TUI_CACHE_VERSION = 1;
const TUI_CACHE_FILENAME = 'tui-data-v1.json';
const scopedWindowCache = new WeakMap<TuiData, Map<string, ScopedWindowData>>();

export interface TimeWindowData {
  label: string;
  days: number;
  stats: AggregatedStats;
  dateRange: DateRange;
  daily?: DailyUsage[];
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

export interface ScopedWindowData {
  windowRange: DateRange;
  scopedProviders: ProviderData[];
  events: UsageEvent[];
}

interface CachedTuiDataEnvelope {
  version: number;
  generatedAt: string;
  data: TuiData;
}

export interface LoadAllDataOptions {
  attemptCursorSync?: boolean;
}

function defaultCacheDir(): string {
  try {
    return join(homedir(), '.cache', 'tokenleak');
  } catch {
    return join(tmpdir(), 'tokenleak-cache');
  }
}

export function getTuiDataCachePath(): string {
  return process.env['TOKENLEAK_TUI_CACHE_PATH'] ?? join(defaultCacheDir(), TUI_CACHE_FILENAME);
}

function isCursorSetupStatus(value: unknown): value is CursorSetupStatus {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const status = value as Record<string, unknown>;
  return (
    typeof status['state'] === 'string' &&
    typeof status['hasCredentials'] === 'boolean' &&
    typeof status['hasCache'] === 'boolean'
  );
}

function isTuiData(value: unknown): value is TuiData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const data = value as Record<string, unknown>;
  return (
    Array.isArray(data['providers']) &&
    typeof data['allTimeStats'] === 'object' &&
    data['allTimeStats'] !== null &&
    Array.isArray(data['windows']) &&
    typeof data['dateRange'] === 'object' &&
    data['dateRange'] !== null &&
    Array.isArray(data['mergedDaily']) &&
    isCursorSetupStatus(data['cursorSetupStatus'])
  );
}

function normalizeCachedCursorSetupStatus(status: CursorSetupStatus): CursorSetupStatus {
  if (status.state !== 'sync_failed_cached') {
    return status;
  }

  const { error, reason, ...rest } = status;
  void error;
  void reason;
  return {
    ...rest,
    state: status.hasCache ? 'ready' : 'needs_sync',
  };
}

function normalizeCachedTuiData(data: TuiData): TuiData {
  const cursorSetupStatus = normalizeCachedCursorSetupStatus(data.cursorSetupStatus);
  if (cursorSetupStatus === data.cursorSetupStatus) {
    return data;
  }

  return {
    ...data,
    cursorSetupStatus,
  };
}

export function readCachedTuiData(): TuiData | null {
  const path = getTuiDataCachePath();
  try {
    if (!existsSync(path)) {
      return null;
    }

    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CachedTuiDataEnvelope;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      parsed.version !== TUI_CACHE_VERSION ||
      !isTuiData(parsed.data)
    ) {
      return null;
    }

    return normalizeCachedTuiData(parsed.data);
  } catch {
    return null;
  }
}

export function writeCachedTuiData(data: TuiData): void {
  const path = getTuiDataCachePath();
  const tmpPath = `${path}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const envelope: CachedTuiDataEnvelope = {
      version: TUI_CACHE_VERSION,
      generatedAt: new Date().toISOString(),
      data: normalizeCachedTuiData(data),
    };
    writeFileSync(tmpPath, `${JSON.stringify(envelope)}\n`, 'utf8');
    renameSync(tmpPath, path);
  } catch {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best effort cache cleanup only.
    }
  }
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

/** Load all provider data and compute aggregations for multiple time windows. */
export async function loadAllData(options: LoadAllDataOptions = {}): Promise<TuiData> {
  const cursorSetupStatus = await resolveCursorSetupStatus({
    attemptSync: options.attemptCursorSync ?? false,
  });
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
    windows.push({ label, days, stats, dateRange, daily: filtered, nutritionOutcomeSignals: [] });
  }

  // Add all-time window
  windows.push({
    label: 'ALL',
    days: 0,
    stats: allTimeStats,
    dateRange: allTimeRange,
    daily: allMerged,
    nutritionOutcomeSignals: [],
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

export async function loadNutritionOutcomeSignalsForWindow(
  state: AppState,
): Promise<NutritionOutcomeSignal[]> {
  const scoped = getScopedWindowData(state);
  if (!state.data || !scoped) {
    return [];
  }

  return collectGitOutcomeSignals(scoped.events, scoped.windowRange);
}

/** Get daily usage data filtered to a specific time window */
export function getDailyForWindow(data: TuiData, windowIndex: number): DailyUsage[] {
  const cachedDaily = data.windows[windowIndex]?.daily;
  if (cachedDaily) {
    return cachedDaily;
  }

  const today = todayStr();
  const days = WINDOW_DAYS[windowIndex];

  if (days === undefined || days === 0) {
    return data.mergedDaily;
  }

  const since = daysAgoStr(days - 1); // trailing N days including today
  return data.mergedDaily.filter((d) => d.date >= since && d.date <= today);
}

function flattenProviderEvents(providers: ProviderData[]): UsageEvent[] {
  const events: UsageEvent[] = [];
  for (const provider of providers) {
    if (provider.events) {
      events.push(...provider.events);
    }
  }
  return events;
}

function scopedWindowKey(state: AppState, windowRange: DateRange): string {
  return `${state.selectedWindowIndex}:${windowRange.since}..${windowRange.until}`;
}

/** Build and cache window-scoped date range, providers, and events for the selected window. */
export function getScopedWindowData(state: AppState): ScopedWindowData | null {
  const data = state.data;
  if (!data || data.windows.length === 0) return null;

  const days = WINDOW_DAYS[state.selectedWindowIndex];
  const selectedWindow = data.windows[state.selectedWindowIndex];
  const windowRange = selectedWindow?.dateRange ?? data.dateRange;
  const key = scopedWindowKey(state, windowRange);
  let cacheForData = scopedWindowCache.get(data);
  if (!cacheForData) {
    cacheForData = new Map();
    scopedWindowCache.set(data, cacheForData);
  }

  const cached = cacheForData.get(key);
  if (cached) {
    return cached;
  }

  const scopedProviders: ProviderData[] =
    days && days > 0
      ? data.providers.map((provider) => {
          const filteredEvents = provider.events?.filter(
            (event) => event.date >= windowRange.since && event.date <= windowRange.until,
          );
          const filteredDaily = provider.daily.filter(
            (day) => day.date >= windowRange.since && day.date <= windowRange.until,
          );
          return {
            ...provider,
            daily: filteredDaily,
            events: filteredEvents,
          };
        })
      : data.providers;
  const scoped: ScopedWindowData = {
    windowRange,
    scopedProviders,
    events: flattenProviderEvents(scopedProviders),
  };

  cacheForData.set(key, scoped);
  return scoped;
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

  const scoped = getScopedWindowData(state);
  if (!scoped) return null;

  const report = buildFocusReport(scoped.events);
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

  const report = buildNutritionReport(
    scoped.events,
    window.nutritionOutcomeSignals,
    window.dateRange,
  );
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
  const filtered =
    filter === null ? receipt.lines : receipt.lines.filter((l) => l.category === filter);
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

  const scoped = getScopedWindowData(state);
  if (!scoped) return null;

  const receipt = buildReceipt(scoped.events, scoped.windowRange);
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
