import type { TokenleakOutput, RenderOptions, DateRange } from '@tokenleak/core';
import type { IProvider } from '@tokenleak/registry';
import {
  renderTabBar,
  renderOverviewView,
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
import { loadTokenleakData } from './data-loader.js';
import { clampScrollOffset, stripAnsi } from './interactive.js';

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
  metricTab: MetricTab;
  scrollOffset: number;
  dataCache: Map<string, TokenleakOutput>;
  noColor: boolean;
  baseUntil: string;
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

async function loadForRange(
  state: TabbedState,
  providers: IProvider[],
): Promise<TokenleakOutput> {
  const cached = state.dataCache.get(state.timeRange);
  if (cached) return cached;

  const range = computeRange(state.timeRange, state.baseUntil);
  const output = await loadTokenleakData(providers, range);
  state.dataCache.set(state.timeRange, output);
  return output;
}

function renderActiveView(output: TokenleakOutput, tab: MetricTab, width: number, noColor: boolean): string {
  const options: RenderOptions = {
    format: 'terminal',
    theme: 'dark',
    width,
    showInsights: true,
    noColor,
    output: null,
    more: true,
  };

  switch (tab) {
    case 'overview': return renderOverviewView(output, options);
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
  const width = Math.max(40, (process.stdout.columns ?? 80) - 1);
  const rows = process.stdout.rows ?? 40;

  const tabBar = renderTabBar(state.timeRange, state.metricTab, width, state.noColor);
  const tabBarLines = tabBar.split('\n');
  const rangeLabel = state.noColor
    ? `  ${output.dateRange.since} → ${output.dateRange.until}`
    : `  ${DIM}${output.dateRange.since} → ${output.dateRange.until}${RESET}`;

  const headerLines = [...tabBarLines, rangeLabel, ''];
  const footerLines = [''];

  const viewportHeight = Math.max(4, rows - headerLines.length - footerLines.length - 1);
  const viewContent = renderActiveView(output, state.metricTab, width, state.noColor);
  const contentLines = viewContent.split('\n');

  const effectiveOffset = clampScrollOffset(state.scrollOffset, contentLines.length, viewportHeight);
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
  const width = Math.max(40, (process.stdout.columns ?? 80) - 1);
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
  until?: string;
}

export async function startTabbedDashboard(
  providers: IProvider[],
  options: TabbedDashboardOptions,
): Promise<void> {
  const state: TabbedState = {
    timeRange: '30d',
    metricTab: 'overview',
    scrollOffset: 0,
    dataCache: new Map(),
    noColor: options.noColor,
    baseUntil: options.until ?? new Date().toISOString().slice(0, 10),
  };

  enterAltScreen();

  let currentOutput: TokenleakOutput | null = null;

  const loadAndRender = async (): Promise<void> => {
    paint(renderLoading(state));
    currentOutput = await loadForRange(state, providers);
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
    await loadAndRender();

    await new Promise<void>((resolve) => {
      const onKeypress = async (
        _input: string,
        key: { name?: string; sequence?: string; ctrl?: boolean; shift?: boolean },
      ): Promise<void> => {
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
          await loadAndRender();
          return;
        }
        if (key.name === 'right') {
          const idx = TIME_RANGES.indexOf(state.timeRange);
          const newIdx = (idx + 1) % TIME_RANGES.length;
          state.timeRange = TIME_RANGES[newIdx]!;
          state.scrollOffset = 0;
          await loadAndRender();
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
        const viewportHeight = Math.max(4, rows - 8);

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
        process.stdin.off('keypress', onKeypress);
        suspendRawMode();
      }

      resumeRawMode();
      process.stdin.on('keypress', onKeypress);
    });
  } finally {
    process.stdout.off('resize', onResize);
    leaveAltScreen();
  }
}
