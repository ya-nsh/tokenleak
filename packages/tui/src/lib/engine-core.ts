import type {
  AgentBehaviorDiffReport,
  CompareOutput,
  ExplainReport,
  FocusReport,
  MoreStats,
  NutritionReport,
  Receipt,
  ReplayReport,
  RoutingSimulationReport,
  SavingsReport,
  TokenleakOutput,
} from '@tokenleak/core';
import { buildCommonsExport, buildCommonsPromptExport, collectGitOutcomeSignals, getTodayLocal } from '@tokenleak/core';
import { buildReplayLiveDataProvider, startLiveSite } from '@tokenleak/renderers';
import type { LiveSite, LiveSiteContent } from '@tokenleak/renderers';
import { writeFileSync } from 'node:fs';
import type { FilterOptions, TuiData } from './data.js';
import { filterTuiData, isFilterActive } from './filter.js';
import type { UsageFilter } from './filter.js';
import {
  buildTokenleakOutput,
  ensureAgentBehaviorDiffReport,
  ensureCompareOutput,
  ensureExplainReport,
  ensureFocusReport,
  ensureMoreStats,
  ensureNutritionReport,
  ensureReceipt,
  ensureReplayReport,
  ensureRoutingSimulationReport,
  ensureSavingsReport,
  getScopedWindowData,
  loadAllData,
  readCachedTuiData,
  writeCachedTuiData,
} from './data.js';
import { createInitialState } from './state.js';
import type { AppState } from './state.js';

/** Every report a view can ask the engine for, by name. */
export interface ReportResults {
  savings: SavingsReport;
  routing: RoutingSimulationReport;
  behavior: AgentBehaviorDiffReport;
  focus: FocusReport;
  nutrition: NutritionReport;
  explain: ExplainReport;
  compare: CompareOutput;
  more: MoreStats;
  receipt: Receipt;
  replay: ReplayReport;
}

export type ReportKind = keyof ReportResults;

export interface ReportRequest<K extends ReportKind = ReportKind> {
  kind: K;
  window: number;
  /** The day for date-scoped reports (`explain`, `replay`); ignored otherwise. */
  date?: string | null;
}

export type ExportKind = 'png' | 'wrapped-png';

export interface LiveSiteRequest {
  /** Serve the replay page for this window, opening on `date` (or the latest active day). */
  replay?: { window: number; date: string | null };
  /** Serve AI Wrapped for this window. */
  wrapped?: { window: number };
}

export interface LiveSiteResult {
  port: number;
  urls: { replay?: string; wrapped?: string };
  /** The day the replay page opened on and its report, so the TUI can match it. */
  replay?: { date: string; report: ReplayReport };
}

/**
 * The TUI's data engine: owns the full usage history (every event), loads and
 * caches it, and builds the reports, exports and live pages that need raw
 * events. Views only ever receive {@link slimTuiData} snapshots and finished
 * reports, so the interface thread never holds or scans the event history.
 *
 * Runs inside a worker (see `engine-worker.ts`) and, if a worker cannot be
 * started, in-process behind the same asynchronous interface.
 */
export class EngineCore {
  /** Everything loaded, before any drill-down. */
  private full: TuiData | null = null;
  private filter: UsageFilter = {};
  /** `full` narrowed by `filter`; what reports, exports and the live site use. */
  private data: TuiData | null = null;
  /** Per-window scratch state so reports share window scoping and routing results. */
  private readonly windowStates = new Map<number, AppState>();
  private liveSite: LiveSite | null = null;

  /** The snapshot saved by the previous run, if any. Becomes the engine's data. */
  async loadCached(): Promise<TuiData | null> {
    const cached = readCachedTuiData();
    if (!cached) return null;
    if (this.full === null) this.setFull(cached);
    return this.slim(this.full === cached ? this.data! : filterTuiData(cached, this.filter), cached);
  }

  /** Reads every provider, replaces the engine's data and saves the snapshot. */
  async loadFresh(options: { attemptCursorSync: boolean }): Promise<TuiData> {
    const fresh = await loadAllData({ attemptCursorSync: options.attemptCursorSync });
    this.setFull(fresh);
    writeCachedTuiData(fresh);
    return this.slim(this.data!, fresh);
  }

  /**
   * Narrows every later report, export and live page to `filter` (an empty
   * filter clears it) and returns the narrowed data, or null before any load.
   */
  async setFilter(filter: UsageFilter): Promise<TuiData | null> {
    this.filter = isFilterActive(filter) ? { ...filter } : {};
    if (!this.full) return null;
    this.setData(filterTuiData(this.full, this.filter));
    return this.slim(this.data!, this.full);
  }

  async report<K extends ReportKind>(request: ReportRequest<K>): Promise<ReportResults[K] | null> {
    const state = this.stateFor(request.window);
    if (!state) return null;
    return (await this.build(state, request)) as ReportResults[K] | null;
  }

  async exportImage(window: number, kind: ExportKind): Promise<string> {
    const output = this.output(window, true);
    if (!output) throw new Error('No data loaded');
    const renderers = await import('@tokenleak/renderers');
    if (kind === 'png') {
      const buffer = await new renderers.PngRenderer().render(output, {
        format: 'png',
        theme: 'dark',
        width: 120,
        showInsights: true,
        noColor: false,
        output: null,
      });
      writeFileSync(PNG_EXPORT_PATH, buffer);
      return PNG_EXPORT_PATH;
    }
    writeFileSync(WRAPPED_EXPORT_PATH, await renderers.renderWrappedPng(output, { theme: 'dark' }));
    return WRAPPED_EXPORT_PATH;
  }

  async llmPrompt(window: number): Promise<string> {
    const output = this.output(window, true);
    if (!output) throw new Error('No data loaded');
    return buildCommonsPromptExport(buildCommonsExport(output));
  }

  /** Starts the live site, or adds pages to the one already running. */
  async openLiveSite(request: LiveSiteRequest): Promise<LiveSiteResult> {
    const content: LiveSiteContent = {};
    let replay: LiveSiteResult['replay'];
    if (request.replay) {
      const state = this.stateFor(request.replay.window);
      if (!state || !this.data) throw new Error('No data loaded');
      const providers = getScopedWindowData(state)?.scopedProviders ?? this.data.providers;
      const provider = buildReplayLiveDataProvider(providers, request.replay.date, getTodayLocal());
      content.replay = provider;
      replay = { date: provider.initialDate, report: provider.initialReport };
    }
    if (request.wrapped) {
      const output = this.output(request.wrapped.window, true);
      if (!output) throw new Error('No data loaded');
      content.wrapped = output;
    }

    if (this.liveSite) this.liveSite.update(content);
    else this.liveSite = await startLiveSite(content);
    const site = this.liveSite;
    return {
      port: site.port,
      urls: {
        ...(content.replay ? { replay: site.url('replay') } : {}),
        ...(content.wrapped ? { wrapped: site.url('wrapped') } : {}),
      },
      ...(replay ? { replay } : {}),
    };
  }

  async stopLiveSite(): Promise<void> {
    if (!this.liveSite) return;
    try {
      this.liveSite.stop();
    } finally {
      this.liveSite = null;
    }
  }

  private setFull(full: TuiData): void {
    this.full = full;
    this.setData(filterTuiData(full, this.filter));
  }

  private setData(data: TuiData): void {
    this.data = data;
    this.windowStates.clear();
  }

  private slim(data: TuiData, full: TuiData): TuiData {
    return { ...slimTuiData(data), filterOptions: filterOptionsOf(full) };
  }

  private stateFor(window: number): AppState | null {
    if (!this.data || !this.data.windows[window]) return null;
    let state = this.windowStates.get(window);
    if (!state) {
      state = createInitialState();
      state.data = this.data;
      state.selectedWindowIndex = window;
      this.windowStates.set(window, state);
    }
    return state;
  }

  private output(window: number, computeMore: boolean): TokenleakOutput | null {
    const state = this.stateFor(window);
    return state ? buildTokenleakOutput(state, { computeMore }) : null;
  }

  private async build(state: AppState, request: ReportRequest): Promise<ReportResults[ReportKind] | null> {
    switch (request.kind) {
      case 'savings':
        return ensureSavingsReport(state);
      case 'routing':
        return ensureRoutingSimulationReport(state);
      case 'behavior':
        return ensureAgentBehaviorDiffReport(state);
      case 'focus':
        return ensureFocusReport(state);
      case 'compare':
        return ensureCompareOutput(state);
      case 'more':
        return ensureMoreStats(state);
      case 'receipt':
        return ensureReceipt(state);
      case 'explain':
        state.explainDate = request.date ?? null;
        return ensureExplainReport(state);
      case 'replay':
        state.replayDate = request.date ?? null;
        return ensureReplayReport(state);
      case 'nutrition':
        return this.nutrition(state);
    }
  }

  /** Git outcome signals are gathered once per window, then the report is cached. */
  private async nutrition(state: AppState): Promise<NutritionReport | null> {
    if (state.cachedNutritionReport) return state.cachedNutritionReport;
    const window = state.data?.windows[state.selectedWindowIndex];
    const scoped = getScopedWindowData(state);
    if (!window || !scoped) return null;
    const data = state.data;
    const signals = await collectGitOutcomeSignals(scoped.events, scoped.windowRange);
    // A reload while git ran replaced this window's data; its report is stale.
    if (this.data !== data) return null;
    window.nutritionOutcomeSignals = signals;
    return ensureNutritionReport(state);
  }
}

/** Providers and models a drill-down can pick from, biggest spend first. */
export function filterOptionsOf(data: TuiData): FilterOptions {
  const providers = [...data.providers]
    .sort((a, b) => b.totalCost - a.totalCost || a.displayName.localeCompare(b.displayName))
    .map((provider) => ({ key: provider.provider, label: provider.displayName }));
  const models = (data.allTimeStats.allModels ?? data.allTimeStats.topModels)
    .slice()
    .sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model))
    .map((entry) => entry.model);
  return { providers, models };
}

const PNG_EXPORT_PATH = 'tokenleak.png';
const WRAPPED_EXPORT_PATH = 'tokenleak-wrapped.png';

/**
 * A copy of the data without per-event history: provider totals, daily rows
 * and window stats only. This is what crosses to the interface thread.
 */
export function slimTuiData(data: TuiData): TuiData {
  return {
    ...data,
    providers: data.providers.map(({ events: _events, ...provider }) => provider),
  };
}
