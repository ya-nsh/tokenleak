import type {
  AggregatedStats,
  AgentBehaviorDiffReport,
  BehaviorCohortSelector,
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
  RoutingSimulationReport,
  SavingsReport,
  TokenleakOutput,
  UsageEvent,
} from '@tokenleak/core';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  aggregate,
  buildAgentBehaviorDiffReport,
  buildExplainReport,
  buildFocusReport,
  buildMoreStats,
  buildNutritionReport,
  buildReceipt,
  buildRoutingSimulationReport,
  buildSavingsReport,
  buildDailyCostCompleteness,
  buildReplayReport,
  collectGitOutcomeSignals,
  compareRanges,
  dayOfWeekBreakdown,
  getTodayLocal,
  getTokenleakCacheDir,
  SUPERSEDED_CACHE_MAX_IDLE_MS,
  mergeProviderData,
  SCHEMA_VERSION,
  shiftDateStringLocal,
} from '@tokenleak/core';
import {
  ProviderRegistry,
  ClaudeCodeProvider,
  CodexProvider,
  CursorProvider,
  GeminiProvider,
  CopilotProvider,
  AmpProvider,
  CodebuffProvider,
  DroidProvider,
  QwenProvider,
  RooCodeProvider,
  KiloCodeProvider,
  KimiProvider,
  KiloProvider,
  MuxProvider,
  CrushProvider,
  OpenClawProvider,
  HermesProvider,
  GooseProvider,
  AntigravityProvider,
  ZedProvider,
  KiroProvider,
  TraeProvider,
  OpenCodeProvider,
  PiProvider,
  buildPricingTable,
  resolveCursorSetupStatus,
  type CursorSetupStatus,
} from '@tokenleak/registry';
import type { AppState } from './state.js';
import { WINDOW_DAYS } from './state.js';

// v3: snapshots from before current-model pricing showed costs as Unknown.
// v4: the ALL window starts at the first day with usage, not the 2020 load floor.
const TUI_CACHE_VERSION = 4;
const TUI_CACHE_FILENAME = `tui-data-v${TUI_CACHE_VERSION}.json`;
const TUI_CACHE_FILE_PATTERN = /^tui-data-v\d+\.json$/;
/** Start of the ALL window: earlier than any supported tool's logs. */
const ALL_TIME_SINCE = '2020-01-01';
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
  /** What a drill-down can narrow to, from the unfiltered data; set by the engine. */
  filterOptions?: FilterOptions;
}

export interface FilterOptions {
  providers: { key: string; label: string }[];
  /** Models by all-time cost, most expensive first. */
  models: string[];
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

export function getTuiDataCachePath(): string {
  return process.env['TOKENLEAK_TUI_CACHE_PATH'] ?? join(getTokenleakCacheDir(), TUI_CACHE_FILENAME);
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

/**
 * Delete snapshots written by other TUI versions next to the current one, once
 * they have gone a week without a write. A version that still runs (an older
 * global install beside a local build, say) keeps its snapshot, so neither
 * version starts cold because the other ran last.
 */
export function removeSupersededTuiCaches(currentPath: string, now: number = Date.now()): string[] {
  const removed: string[] = [];
  const directory = dirname(currentPath);
  const current = basename(currentPath);
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (name === current || !TUI_CACHE_FILE_PATTERN.test(name)) continue;
    const path = join(directory, name);
    try {
      if (now - statSync(path).mtimeMs <= SUPERSEDED_CACHE_MAX_IDLE_MS) continue;
      rmSync(path, { force: true });
      removed.push(name);
    } catch {
      // Best effort only.
    }
  }
  return removed;
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
    removeSupersededTuiCaches(path);
  } catch {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Best effort cache cleanup only.
    }
  }
}

function todayStr(): string {
  return getTodayLocal();
}

function daysAgoStr(days: number): string {
  return shiftDateStringLocal(todayStr(), -days);
}

/** Create and populate the provider registry with all known providers */
function createRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new ClaudeCodeProvider());
  registry.register(new CodexProvider());
  registry.register(new CursorProvider());
  registry.register(new GeminiProvider());
  registry.register(new CopilotProvider());
  registry.register(new AmpProvider());
  registry.register(new CodebuffProvider());
  registry.register(new DroidProvider());
  registry.register(new QwenProvider());
  registry.register(new RooCodeProvider());
  registry.register(new KiloCodeProvider());
  registry.register(new KimiProvider());
  registry.register(new KiloProvider());
  registry.register(new MuxProvider());
  registry.register(new CrushProvider());
  registry.register(new OpenClawProvider());
  registry.register(new HermesProvider());
  registry.register(new GooseProvider());
  registry.register(new AntigravityProvider());
  registry.register(new ZedProvider());
  registry.register(new KiroProvider());
  registry.register(new TraeProvider());
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
  const results = await registry.loadAll({ since: ALL_TIME_SINCE, until: today });

  const providers: ProviderData[] = results
    .filter((r) => r.data !== null)
    .map((r) => r.data as ProviderData);

  return buildTuiData(providers, cursorSetupStatus, today);
}

/** Trailing windows the TUI offers besides ALL, in display order. */
const WINDOW_CONFIGS = [
  { label: '1D', days: 1 },
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
] as const;

/** Merges provider data and aggregates every time window ending on `today`. */
export function buildTuiData(
  providers: ProviderData[],
  cursorSetupStatus: CursorSetupStatus,
  today: string = todayStr(),
): TuiData {
  const allTimeRange: DateRange = { since: ALL_TIME_SINCE, until: today };
  if (providers.length === 0) {
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
  // ALL spans the user's own history, not the loader's 2020 floor: exports and
  // heatmaps sized from the floor were years wide and mostly empty.
  const usageRange: DateRange = { since: allMerged[0]?.date ?? today, until: today };
  const windows: TimeWindowData[] = [];

  for (const { label, days } of WINDOW_CONFIGS) {
    const since = shiftDateStringLocal(today, -(days - 1)); // trailing N days including today
    const dateRange: DateRange = { since, until: today };
    const filtered = allMerged.filter((d) => d.date >= since && d.date <= today);
    const stats = aggregate(filtered, today, dateRange);
    windows.push({ label, days, stats, dateRange, daily: filtered, nutritionOutcomeSignals: [] });
  }

  windows.push({
    label: 'ALL',
    days: 0,
    stats: allTimeStats,
    dateRange: usageRange,
    daily: allMerged,
    nutritionOutcomeSignals: [],
  });

  return {
    providers,
    allTimeStats,
    windows,
    dateRange: usageRange,
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

export function sumDailyTotals(
  daily: ProviderData['daily'],
): Pick<ProviderData, 'totalTokens' | 'totalCost' | 'costCompleteness'> {
  const costCompleteness = buildDailyCostCompleteness(daily);
  return daily.reduce(
    (totals, day) => ({
      totalTokens: totals.totalTokens + day.totalTokens,
      totalCost: totals.totalCost + day.cost,
      costCompleteness,
    }),
    { totalTokens: 0, totalCost: 0, costCompleteness },
  );
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
          const totals = sumDailyTotals(filteredDaily);
          return {
            ...provider,
            ...totals,
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

export function ensureRoutingSimulationReport(state: AppState): RoutingSimulationReport | null {
  if (!state.data || state.data.windows.length === 0) return null;
  if (state.cachedRoutingSimulationReport) return state.cachedRoutingSimulationReport;

  const scoped = getScopedWindowData(state);
  if (!scoped) return null;

  const report = buildRoutingSimulationReport(scoped.events, scoped.windowRange, buildPricingTable(scoped.events.map((event) => event.model)), {
    strategy: 'conservative',
  });
  state.cachedRoutingSimulationReport = report;
  return report;
}

/** Lazily compute and cache the savings report behind the Advisor and Waste views (window-dependent). */
export function ensureSavingsReport(state: AppState): SavingsReport | null {
  if (!state.data || state.data.windows.length === 0) return null;
  if (state.cachedSavingsReport) return state.cachedSavingsReport;

  const scoped = getScopedWindowData(state);
  const routing = ensureRoutingSimulationReport(state);
  if (!scoped || !routing) return null;

  const report = buildSavingsReport({
    providers: scoped.scopedProviders,
    events: scoped.events,
    dateRange: scoped.windowRange,
    pricing: buildPricingTable(scoped.events.map((event) => event.model)),
    routing,
  });
  state.cachedSavingsReport = report;
  return report;
}

function defaultBehaviorSelectors(scoped: ScopedWindowData): [BehaviorCohortSelector, BehaviorCohortSelector] {
  const providerTotals = scoped.scopedProviders
    .map((provider) => ({
      provider: provider.provider,
      label: provider.displayName,
      tokens: provider.totalTokens,
    }))
    .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));

  if (providerTotals.length >= 2) {
    return [
      { label: providerTotals[0]!.label, dimension: 'provider', provider: providerTotals[0]!.provider },
      { label: providerTotals[1]!.label, dimension: 'provider', provider: providerTotals[1]!.provider },
    ];
  }

  const models = new Map<string, number>();
  for (const event of scoped.events) {
    models.set(event.model, (models.get(event.model) ?? 0) + event.totalTokens);
  }
  const modelTotals = [...models.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (modelTotals.length >= 2) {
    return [
      { label: modelTotals[0]![0], dimension: 'model', model: modelTotals[0]![0] },
      { label: modelTotals[1]![0], dimension: 'model', model: modelTotals[1]![0] },
    ];
  }

  return [
    { label: 'Current window', dimension: 'date-range', dateRange: scoped.windowRange },
    { label: 'Current window', dimension: 'date-range', dateRange: scoped.windowRange },
  ];
}

export function ensureAgentBehaviorDiffReport(state: AppState): AgentBehaviorDiffReport | null {
  if (!state.data || state.data.windows.length === 0) return null;
  if (state.cachedBehaviorDiffReport) return state.cachedBehaviorDiffReport;

  const scoped = getScopedWindowData(state);
  if (!scoped) return null;

  const [baseline, comparison] = defaultBehaviorSelectors(scoped);
  const report = buildAgentBehaviorDiffReport(scoped.events, scoped.windowRange, baseline, comparison);
  state.cachedBehaviorDiffReport = report;
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

/** Keep exported and Wrapped provider data in the same window as the header totals. */
export function buildTokenleakOutput(
  state: AppState,
  options: { computeMore?: boolean } = {},
): TokenleakOutput | null {
  const stats = state.data?.windows[state.selectedWindowIndex]?.stats;
  const scoped = getScopedWindowData(state);
  if (!stats || !scoped) return null;
  const more = options.computeMore ? ensureMoreStats(state) : state.cachedMoreStats;
  return {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange: scoped.windowRange,
    providers: scoped.scopedProviders,
    aggregated: stats,
    ...(more ? { more } : {}),
  };
}
