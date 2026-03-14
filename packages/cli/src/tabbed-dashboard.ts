import type { TokenleakOutput, RenderOptions, DateRange } from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import {
  renderTabBar,
  renderOverviewView,
  renderCompareView,
  renderProviderView,
  renderDowView,
  renderTodView,
  renderSessionView,
  renderModelView,
  renderTokenView,
  renderCwdView,
  TIME_RANGES,
  METRIC_TABS,
} from '@tokenleak/renderers';
import type { TimeRange, MetricTab } from '@tokenleak/renderers';
import { loadCompareTokenleakData, loadTokenleakData } from './data-loader.js';
import { clampScrollOffset } from './interactive.js';

const HOME_CLEAR = '\x1b[H\x1b[J';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const ALT_SCROLL_ON = '\x1b[?1007h';
const ALT_SCROLL_OFF = '\x1b[?1007l';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const YELLOW = '\x1b[33m';

interface TabbedState {
  timeRange: TimeRange;
  initialTimeRange: TimeRange;
  metricTab: MetricTab;
  scrollOffset: number;
  dataCache: Map<TimeRange, TokenleakOutput>;
  inflightLoads: Map<TimeRange, Promise<TokenleakOutput>>;
  noColor: boolean;
  noInsights: boolean;
  compare: string | null;
  baseUntil: string;
  initialRange: DateRange | null;
  width: number | null;
}

function timeRangeToDays(range: TimeRange): number {
  switch (range) {
    case '7d': return 7;
    case '30d': return 30;
    case '90d': return 90;
    case '365d': return 365;
    default: return 30;
  }
}

function computeRange(range: TimeRange, baseUntil: string): DateRange {
  const until = baseUntil;
  const d = new Date(until);
  d.setDate(d.getDate() - timeRangeToDays(range));
  const since = d.toISOString().slice(0, 10);
  return { since, until };
}

function resolveRange(state: TabbedState, timeRange: TimeRange): DateRange {
  if (state.initialRange && timeRange === state.initialTimeRange) {
    return state.initialRange;
  }

  return computeRange(timeRange, state.baseUntil);
}

async function loadForRange(
  state: TabbedState,
  providers: IProvider[],
  timeRange: TimeRange,
): Promise<TokenleakOutput> {
  const cached = state.dataCache.get(timeRange);
  if (cached) return cached;

  const inflight = state.inflightLoads.get(timeRange);
  if (inflight) return inflight;

  const range = resolveRange(state, timeRange);
  const loadPromise = (state.compare
    ? loadCompareTokenleakData(providers, range, state.compare).then((result) => result.output)
    : loadTokenleakData(providers, range))
    .then((output) => {
      state.dataCache.set(timeRange, output);
      return output;
    })
    .finally(() => {
      state.inflightLoads.delete(timeRange);
    });

  state.inflightLoads.set(timeRange, loadPromise);
  return loadPromise;
}

function getRenderWidth(state: TabbedState): number {
  const terminalWidth = Math.max(40, (process.stdout.columns ?? 80) - 1);
  if (state.width === null) {
    return terminalWidth;
  }

  return Math.max(40, Math.min(terminalWidth, state.width));
}

function getViewportHeight(state: TabbedState, width: number, rows: number): number {
  const headerLines = renderTabBar(state.timeRange, state.metricTab, width, state.noColor).split('\n').length + 2;
  const footerLines = 1;
  return Math.max(4, rows - headerLines - footerLines - 1);
}

function renderActiveView(
  output: TokenleakOutput,
  tab: MetricTab,
  width: number,
  noColor: boolean,
  noInsights: boolean,
): string {
  const options: RenderOptions = {
    format: 'terminal',
    theme: 'dark',
    width,
    showInsights: !noInsights,
    noColor,
    output: null,
    more: true,
  };

  switch (tab) {
    case 'overview': return renderOverviewView(output, options);
    case 'delta': return renderCompareView(output, width, noColor);
    case 'provider': return renderProviderView(output, width, noColor);
    case 'sess': return renderSessionView(output, width, noColor);
    case 'tok': return renderTokenView(output, width, noColor);
    case 'model': return renderModelView(output, width, noColor);
    case 'cwd': return renderCwdView(output, width, noColor);
    case 'dow': return renderDowView(output, width, noColor);
    case 'tod': return renderTodView(output, width, noColor);
    default: return renderOverviewView(output, options);
  }
}

function renderScreen(
  output: TokenleakOutput,
  state: TabbedState,
): string {
  const width = getRenderWidth(state);
  const rows = process.stdout.rows ?? 40;

  const tabBar = renderTabBar(state.timeRange, state.metricTab, width, state.noColor);
  const tabBarLines = tabBar.split('\n');
  const rangeLabel = state.noColor
    ? `  ${output.dateRange.since} → ${output.dateRange.until}`
    : `  ${DIM}${output.dateRange.since} → ${output.dateRange.until}${RESET}`;

  const headerLines = [...tabBarLines, rangeLabel, ''];
  const footerLines = [''];

  const viewportHeight = getViewportHeight(state, width, rows);
  const viewContent = renderActiveView(output, state.metricTab, width, state.noColor, state.noInsights);
  const contentLines = viewContent.split('\n');

  const effectiveOffset = clampScrollOffset(state.scrollOffset, contentLines.length, viewportHeight);
  state.scrollOffset = effectiveOffset;
  const visibleContent = contentLines.slice(effectiveOffset, effectiveOffset + viewportHeight);
  const padding = Array.from({ length: Math.max(0, viewportHeight - visibleContent.length) }, () => '');

  const scrollInfo = contentLines.length > viewportHeight
    ? (state.noColor
      ? `  Lines ${effectiveOffset + 1}-${Math.min(contentLines.length, effectiveOffset + viewportHeight)} of ${contentLines.length}`
      : `  ${DIM}Lines ${effectiveOffset + 1}-${Math.min(contentLines.length, effectiveOffset + viewportHeight)} of ${contentLines.length}${RESET}`)
    : '';

  return `${HOME_CLEAR}${HIDE_CURSOR}${[
    ...headerLines,
    ...visibleContent,
    ...padding,
    scrollInfo,
    ...footerLines,
  ].join('\n')}`;
}

function renderLoading(state: TabbedState): string {
  const width = getRenderWidth(state);
  const tabBar = renderTabBar(state.timeRange, state.metricTab, width, state.noColor);
  const loading = state.noColor
    ? '  Loading data...'
    : `  ${YELLOW}${BOLD}Loading data...${RESET}`;
  return `${HOME_CLEAR}${HIDE_CURSOR}${tabBar}\n\n${loading}`;
}

function enterAltScreen(): void {
  process.stdout.write(`${ALT_SCREEN_ON}${ALT_SCROLL_ON}${HOME_CLEAR}${HIDE_CURSOR}`);
}

function leaveAltScreen(): void {
  process.stdout.write(`${SHOW_CURSOR}${ALT_SCROLL_OFF}${ALT_SCREEN_OFF}`);
}

function paint(content: string): void {
  process.stdout.write(content);
}

function suspendRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  process.stdout.write(SHOW_CURSOR);
}

function resumeRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdout.write(HIDE_CURSOR);
}

export interface TabbedDashboardOptions {
  noColor: boolean;
  noInsights?: boolean;
  compare?: string;
  width?: number;
  until?: string;
  initialTimeRange?: TimeRange;
  initialRange?: DateRange;
  providerNames?: string[];
}

export async function startTabbedDashboard(
  providers: IProvider[],
  options: TabbedDashboardOptions,
): Promise<void> {
  const state: TabbedState = {
    timeRange: options.initialTimeRange ?? '30d',
    initialTimeRange: options.initialTimeRange ?? '30d',
    metricTab: 'overview',
    scrollOffset: 0,
    dataCache: new Map(),
    inflightLoads: new Map(),
    noColor: options.noColor,
    noInsights: options.noInsights ?? false,
    compare: options.compare ?? 'auto',
    baseUntil: options.until ?? new Date().toISOString().slice(0, 10),
    initialRange: options.initialRange ?? null,
    width: options.width ?? null,
  };

  enterAltScreen();

  let currentOutput: TokenleakOutput | null = null;
  let activeLoadId = 0;
  let shouldClose = false;

  const loadAndRender = async (timeRange: TimeRange): Promise<void> => {
    const loadId = ++activeLoadId;
    paint(renderLoading(state));
    let output: TokenleakOutput;
    try {
      output = await loadForRange(state, providers, timeRange);
    } catch (error: unknown) {
      if (shouldClose || loadId !== activeLoadId || state.timeRange !== timeRange) {
        return;
      }
      throw error;
    }
    if (shouldClose || loadId !== activeLoadId || state.timeRange !== timeRange) {
      return;
    }
    currentOutput = output;
    paint(renderScreen(currentOutput, state));
  };

  const rerender = (): void => {
    if (currentOutput) {
      paint(renderScreen(currentOutput, state));
    }
  };

  const onResize = (): void => {
    rerender();
  };

  process.stdout.on('resize', onResize);

  try {
    await loadAndRender(state.timeRange);

    let fatalError: unknown = null;
    await new Promise<void>((resolve) => {
      const settleFailure = (error: unknown): void => {
        fatalError = error;
        cleanup();
        resolve();
      };

      const runAsyncAction = (action: () => Promise<void>): void => {
        void action().catch((error: unknown) => {
          settleFailure(error);
        });
      };

      const onKeypress = (
        _input: string,
        key: { name?: string; sequence?: string; ctrl?: boolean; shift?: boolean },
      ): void => {
        if (key.ctrl && key.name === 'c') {
          cleanup();
          resolve();
          return;
        }

        if (key.name === 'q' || key.name === 'escape') {
          cleanup();
          resolve();
          return;
        }

        // Range switching: left/right arrows
        if (key.name === 'left') {
          const idx = TIME_RANGES.indexOf(state.timeRange);
          const newIdx = (idx - 1 + TIME_RANGES.length) % TIME_RANGES.length;
          state.timeRange = TIME_RANGES[newIdx]!;
          state.scrollOffset = 0;
          runAsyncAction(() => loadAndRender(state.timeRange));
          return;
        }
        if (key.name === 'right') {
          const idx = TIME_RANGES.indexOf(state.timeRange);
          const newIdx = (idx + 1) % TIME_RANGES.length;
          state.timeRange = TIME_RANGES[newIdx]!;
          state.scrollOffset = 0;
          runAsyncAction(() => loadAndRender(state.timeRange));
          return;
        }

        // Tab cycling: tab / shift+tab
        if (key.name === 'tab') {
          const idx = METRIC_TABS.indexOf(state.metricTab);
          const newIdx = key.shift
            ? (idx - 1 + METRIC_TABS.length) % METRIC_TABS.length
            : (idx + 1) % METRIC_TABS.length;
          state.metricTab = METRIC_TABS[newIdx]!;
          state.scrollOffset = 0;
          rerender();
          return;
        }

        // Number keys 1-7 to jump to specific tab
        const digit = key.sequence?.match(/^[1-7]$/)?.[0];
        if (digit) {
          const tabIdx = Number(digit) - 1;
          if (tabIdx < METRIC_TABS.length) {
            state.metricTab = METRIC_TABS[tabIdx]!;
            state.scrollOffset = 0;
            rerender();
          }
          return;
        }

        // Scrolling
        const rows = process.stdout.rows ?? 40;
        const viewportHeight = getViewportHeight(state, getRenderWidth(state), rows);

        if (key.name === 'up') {
          state.scrollOffset = Math.max(0, state.scrollOffset - 1);
          rerender();
          return;
        }
        if (key.name === 'down') {
          state.scrollOffset += 1;
          rerender();
          return;
        }
        if (key.name === 'pageup') {
          state.scrollOffset = Math.max(0, state.scrollOffset - viewportHeight);
          rerender();
          return;
        }
        if (key.name === 'pagedown') {
          state.scrollOffset += viewportHeight;
          rerender();
          return;
        }
        if (key.name === 'home') {
          state.scrollOffset = 0;
          rerender();
          return;
        }
        if (key.name === 'end') {
          state.scrollOffset = Number.MAX_SAFE_INTEGER;
          rerender();
          return;
        }
      };

      function cleanup(): void {
        shouldClose = true;
        process.stdin.off('keypress', onKeypress);
        suspendRawMode();
      }

      resumeRawMode();
      process.stdin.on('keypress', onKeypress);
    });
    if (fatalError) {
      throw fatalError;
    }
  } finally {
    process.stdout.off('resize', onResize);
    leaveAltScreen();
  }
}
