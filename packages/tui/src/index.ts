import { Box, Text, createCliRenderer } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import type { TokenleakOutput } from '@tokenleak/core';
import { SCHEMA_VERSION } from '@tokenleak/core';
import { computeAchievements } from '@tokenleak/renderers';
import { COLORS, BOLD } from './lib/theme.js';
import {
  loadAllData,
  getDailyForWindow,
  ensureAdvisorReport,
  ensureFocusReport,
  ensureExplainReport,
  ensureCompareOutput,
  ensureMoreStats,
} from './lib/data.js';
import { createInitialState, WINDOW_LABELS, WINDOW_DAYS } from './lib/state.js';
import type { AppState, ViewMode } from './lib/state.js';
import { buildHeader } from './panels/header.js';
import { createChartPanel } from './panels/chart-panel.js';
import { createStatsRow } from './panels/stats-row.js';
import { createModelList } from './panels/model-list.js';
import { buildStatusBar } from './panels/status-bar.js';
import { createMatrixView } from './panels/bloomberg.js';
import { createAdvisorPanel } from './panels/advisor.js';
import { createFocusPanel } from './panels/focus.js';
import { createExplainPanel } from './panels/explain.js';
import { createComparePanel } from './panels/compare.js';
import { createExportPanel } from './panels/export.js';
import { createWrappedPanel } from './panels/wrapped.js';
import { createHelpPanel } from './panels/help.js';

function clearRoot(renderer: CliRenderer): void {
  const children = renderer.root.getChildren();
  for (const child of children) {
    renderer.root.remove(child.id);
  }
}

function buildContent(state: AppState) {
  // Help overlay takes priority
  if (state.showHelp) {
    return createHelpPanel();
  }

  const windowStats = state.data?.windows[state.selectedWindowIndex]?.stats ?? null;
  const daily = state.data ? getDailyForWindow(state.data, state.selectedWindowIndex) : [];

  switch (state.selectedView) {
    case 'overview':
      return Box(
        { flexDirection: 'column', width: '100%', flexGrow: 1 },
        createChartPanel(state, daily),
        createStatsRow(state, windowStats),
        createModelList(state, windowStats),
      );
    case 'matrix':
      return createMatrixView(state);
    case 'advisor':
      return createAdvisorPanel(state, ensureAdvisorReport(state));
    case 'focus':
      return createFocusPanel(state, ensureFocusReport(state));
    case 'explain':
      return createExplainPanel(ensureExplainReport(state), state.explainDate);
    case 'compare':
      return createComparePanel(state, ensureCompareOutput(state));
    case 'export':
      return createExportPanel(state);
    case 'wrapped': {
      const output = buildTokenleakOutput(state);
      const achievements = output ? computeAchievements(output) : [];
      const providers = state.data?.providers.map((p) => ({
        displayName: p.displayName,
        totalTokens: p.totalTokens,
        totalCost: p.totalCost,
      })) ?? [];
      return createWrappedPanel(windowStats, achievements, providers, state.wrappedScrollOffset, ensureMoreStats(state));
    }
    default:
      return Box({ flexDirection: 'column', width: '100%', flexGrow: 1 });
  }
}

/** Build a TokenleakOutput from current state for renderers */
function buildTokenleakOutput(state: AppState): TokenleakOutput | null {
  if (!state.data || state.data.windows.length === 0) return null;
  const windowStats = state.data.windows[state.selectedWindowIndex]?.stats;
  if (!windowStats) return null;

  // Scope dateRange to the selected window
  const days = WINDOW_DAYS[state.selectedWindowIndex];
  const today = new Date().toISOString().slice(0, 10);

  const dateRange = days && days > 0
    ? { since: (() => { const d = new Date(); d.setDate(d.getDate() - (days - 1)); return d.toISOString().slice(0, 10); })(), until: today }
    : state.data.dateRange;

  // Attach more stats if available for achievements that need hourOfDay
  const more = ensureMoreStats(state);

  const output: TokenleakOutput = {
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    dateRange,
    providers: state.data.providers,
    aggregated: windowStats,
  };

  // Attach more stats for computeAchievements to use
  if (more) {
    (output as TokenleakOutput & { more?: unknown }).more = more;
  }

  return output;
}

let currentState: AppState;
let currentRenderer: CliRenderer;

function handleViewSwitch(mode: ViewMode): void {
  if (currentState.selectedView !== mode) {
    currentState.selectedView = mode;
    currentState.modelScrollOffset = 0;
    currentState.advisorScrollOffset = 0;
    currentState.focusScrollOffset = 0;
    currentState.compareScrollOffset = 0;
    currentState.wrappedScrollOffset = 0;
    // Reset matrix page when switching to matrix
    if (mode === 'matrix') {
      currentState.matrixPage = 0;
    }
  }
  render(currentState, currentRenderer);
}

function buildLayout(state: AppState, renderer: CliRenderer) {
  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      backgroundColor: COLORS.bg,
    },
    buildHeader(state, renderer, handleViewSwitch),
    buildContent(state),
    buildStatusBar(state),
  );
}

function render(state: AppState, renderer: CliRenderer): void {
  clearRoot(renderer);
  renderer.root.add(buildLayout(state, renderer));
  renderer.requestRender();
}

/** Null caches that depend on the selected window */
function invalidateWindowCaches(state: AppState): void {
  state.cachedAdvisorReport = null;
  state.cachedCompareOutput = null;
  state.cachedFocusReport = null;
  state.cachedExplainReport = null;
  state.cachedMoreStats = null;
  state.explainDate = null; // re-derive from new window's peak day
}

/** Null all caches (used on refresh) */
function invalidateAllCaches(state: AppState): void {
  state.cachedAdvisorReport = null;
  state.cachedFocusReport = null;
  state.cachedExplainReport = null;
  state.cachedCompareOutput = null;
  state.cachedMoreStats = null;
}

/** Navigate explain date forward or backward by one day */
function shiftExplainDate(state: AppState, direction: number): void {
  if (!state.explainDate) return;
  const d = new Date(state.explainDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + direction);
  state.explainDate = d.toISOString().slice(0, 10);
  state.cachedExplainReport = null;
}

const VIEW_KEYS: Record<string, ViewMode> = {
  '1': 'overview',
  '2': 'matrix',
  '3': 'advisor',
  '4': 'focus',
  '5': 'explain',
  '6': 'compare',
  '7': 'export',
  '8': 'wrapped',
};

const VIEW_ORDER: ViewMode[] = [
  'overview', 'matrix', 'advisor', 'focus', 'explain', 'compare', 'export', 'wrapped',
];

/** Views that support j/k scrolling and their scroll offset field */
const SCROLLABLE_VIEWS = new Set<ViewMode>(['advisor', 'focus', 'compare', 'wrapped']);

function getScrollableItemCount(state: AppState): number {
  switch (state.selectedView) {
    case 'advisor':
      return ensureAdvisorReport(state)?.recommendations.length ?? 0;
    case 'focus': {
      const report = ensureFocusReport(state);
      return Math.min(report?.entries.length ?? 0, 20);
    }
    case 'compare':
      return 6; // fixed metric rows
    case 'wrapped':
      return 30; // approximate content rows
    default:
      return 0;
  }
}

function getVisibleCount(view: ViewMode): number {
  switch (view) {
    case 'advisor': return 10;
    case 'focus': return 12;
    case 'compare': return 6;
    case 'wrapped': return 20;
    default: return 10;
  }
}

function getScrollOffset(state: AppState): number {
  switch (state.selectedView) {
    case 'advisor': return state.advisorScrollOffset;
    case 'focus': return state.focusScrollOffset;
    case 'compare': return state.compareScrollOffset;
    case 'wrapped': return state.wrappedScrollOffset;
    default: return 0;
  }
}

function setScrollOffset(state: AppState, value: number): void {
  switch (state.selectedView) {
    case 'advisor': state.advisorScrollOffset = value; break;
    case 'focus': state.focusScrollOffset = value; break;
    case 'compare': state.compareScrollOffset = value; break;
    case 'wrapped': state.wrappedScrollOffset = value; break;
  }
}

/** Handle export actions (p/w/l keys in export view) */
async function handleExport(
  key: 'p' | 'w' | 'l',
  state: AppState,
  renderer: CliRenderer,
): Promise<void> {
  const output = buildTokenleakOutput(state);
  if (!output) {
    state.exportStatus = 'Error: No data loaded';
    render(state, renderer);
    return;
  }

  try {
    if (key === 'p') {
      state.exportStatus = 'Rendering PNG...';
      render(state, renderer);

      const { PngRenderer } = await import('@tokenleak/renderers');
      const pngRenderer = new PngRenderer();
      const buffer = await pngRenderer.render(output, {
        format: 'png',
        theme: 'dark',
        width: 120,
        showInsights: true,
        noColor: false,
        output: null,
      });
      const { writeFileSync } = await import('node:fs');
      const outputPath = 'tokenleak.png';
      writeFileSync(outputPath, buffer);
      state.exportStatus = `Saved to ${outputPath}`;
    } else if (key === 'w') {
      state.exportStatus = 'Rendering Wrapped PNG...';
      render(state, renderer);

      const { renderWrappedPng } = await import('@tokenleak/renderers');
      const buffer = await renderWrappedPng(output, { theme: 'dark' });
      const { writeFileSync } = await import('node:fs');
      const outputPath = 'tokenleak-wrapped.png';
      writeFileSync(outputPath, buffer);
      state.exportStatus = `Saved to ${outputPath}`;
    } else if (key === 'l') {
      state.exportStatus = 'Starting live server...';
      render(state, renderer);

      const { startWrappedLiveServer } = await import('@tokenleak/renderers');
      const { port } = await startWrappedLiveServer(output);
      state.exportStatus = `Live server running at http://localhost:${port} (Ctrl+C to stop)`;
    }
  } catch (err: unknown) {
    state.exportStatus = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }

  render(state, renderer);
}

export async function main(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: COLORS.bg,
    useMouse: true,
  });

  const state = createInitialState();
  currentState = state;
  currentRenderer = renderer;

  // Show loading state immediately
  render(state, renderer);

  try {
    const data = await loadAllData();
    state.data = data;
    state.isLoading = false;
    render(state, renderer);

    renderer.addInputHandler((sequence: string) => {
      // Help toggle: ? key
      if (sequence === '?') {
        state.showHelp = !state.showHelp;
        render(state, renderer);
        return true;
      }

      // Escape closes help
      if (sequence === '\x1b' && state.showHelp) {
        state.showHelp = false;
        render(state, renderer);
        return true;
      }

      // While help is shown, only ?, Escape, and q are handled
      if (state.showHelp) {
        if (sequence === 'q') {
          renderer.destroy();
          process.exit(0);
        }
        return false;
      }

      // Tab: next time window
      if (sequence === '\t') {
        state.selectedWindowIndex = (state.selectedWindowIndex + 1) % WINDOW_LABELS.length;
        state.modelScrollOffset = 0;
        invalidateWindowCaches(state);
        render(state, renderer);
        return true;
      }

      // Shift+Tab: prev time window
      if (sequence === '\x1b[Z') {
        state.selectedWindowIndex =
          (state.selectedWindowIndex - 1 + WINDOW_LABELS.length) % WINDOW_LABELS.length;
        state.modelScrollOffset = 0;
        invalidateWindowCaches(state);
        render(state, renderer);
        return true;
      }

      // Right arrow: next view
      if (sequence === '\x1b[C') {
        const idx = VIEW_ORDER.indexOf(state.selectedView);
        const next = VIEW_ORDER[(idx + 1) % VIEW_ORDER.length]!;
        handleViewSwitch(next);
        return true;
      }

      // Left arrow: prev view
      if (sequence === '\x1b[D') {
        const idx = VIEW_ORDER.indexOf(state.selectedView);
        const prev = VIEW_ORDER[(idx - 1 + VIEW_ORDER.length) % VIEW_ORDER.length]!;
        handleViewSwitch(prev);
        return true;
      }

      // Matrix page navigation: , or [ = prev page, . or ] = next page
      if ((sequence === ',' || sequence === '[') && state.selectedView === 'matrix') {
        state.matrixPage = Math.max(0, state.matrixPage - 1);
        render(state, renderer);
        return true;
      }
      if ((sequence === '.' || sequence === ']') && state.selectedView === 'matrix') {
        state.matrixPage = Math.min(3, state.matrixPage + 1);
        render(state, renderer);
        return true;
      }

      // 1-8: switch view
      const viewMode = VIEW_KEYS[sequence];
      if (viewMode) {
        handleViewSwitch(viewMode);
        return true;
      }

      // Export view actions: p/w/l
      if (state.selectedView === 'export' && (sequence === 'p' || sequence === 'w' || sequence === 'l')) {
        handleExport(sequence, state, renderer);
        return true;
      }

      // j / Down: scroll down (overview model list or scrollable views)
      if (sequence === 'j' || sequence === '\x1b[B') {
        if (state.selectedView === 'overview') {
          const windowStats = state.data?.windows[state.selectedWindowIndex]?.stats;
          const modelCount = windowStats?.topModels.length ?? 0;
          const visibleCount = 10;
          const maxOffset = Math.max(0, modelCount - visibleCount);
          if (state.modelScrollOffset < maxOffset) {
            state.modelScrollOffset++;
            render(state, renderer);
          }
          return true;
        }
        if (SCROLLABLE_VIEWS.has(state.selectedView)) {
          const itemCount = getScrollableItemCount(state);
          const visibleCount = getVisibleCount(state.selectedView);
          const maxOffset = Math.max(0, itemCount - visibleCount);
          const current = getScrollOffset(state);
          if (current < maxOffset) {
            setScrollOffset(state, current + 1);
            render(state, renderer);
          }
          return true;
        }
        return false;
      }

      // k / Up: scroll up
      if (sequence === 'k' || sequence === '\x1b[A') {
        if (state.selectedView === 'overview') {
          if (state.modelScrollOffset > 0) {
            state.modelScrollOffset--;
            render(state, renderer);
          }
          return true;
        }
        if (SCROLLABLE_VIEWS.has(state.selectedView)) {
          const current = getScrollOffset(state);
          if (current > 0) {
            setScrollOffset(state, current - 1);
            render(state, renderer);
          }
          return true;
        }
        return false;
      }

      // h: prev day (explain view)
      if (sequence === 'h' && state.selectedView === 'explain') {
        shiftExplainDate(state, -1);
        render(state, renderer);
        return true;
      }

      // l: next day (explain view)
      if (sequence === 'l' && state.selectedView === 'explain') {
        shiftExplainDate(state, 1);
        render(state, renderer);
        return true;
      }

      // s: toggle sort mode
      if (sequence === 's') {
        state.sortMode = state.sortMode === 'cost' ? 'tokens' : 'cost';
        state.modelScrollOffset = 0;
        render(state, renderer);
        return true;
      }

      // r: refresh data
      if (sequence === 'r') {
        state.isLoading = true;
        invalidateAllCaches(state);
        state.exportStatus = null;
        render(state, renderer);

        loadAllData()
          .then((freshData) => {
            state.data = freshData;
            state.isLoading = false;
            state.modelScrollOffset = 0;
            state.advisorScrollOffset = 0;
            state.focusScrollOffset = 0;
            state.compareScrollOffset = 0;
            state.wrappedScrollOffset = 0;
            state.explainDate = null;
            render(state, renderer);
          })
          .catch((err: unknown) => {
            state.isLoading = false;
            state.exportStatus = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
            render(state, renderer);
          });
        return true;
      }

      // q: quit
      if (sequence === 'q') {
        renderer.destroy();
        process.exit(0);
      }

      return false;
    });
  } catch (err: unknown) {
    clearRoot(renderer);
    renderer.root.add(
      Box(
        {
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: COLORS.bg,
          justifyContent: 'center',
          alignItems: 'center',
        },
        Text({
          content: 'TOKENLEAK TUI',
          fg: COLORS.amber,
          attributes: BOLD,
        }),
        Text({
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          fg: COLORS.red,
        }),
        Text({
          content: 'Press q to quit',
          fg: COLORS.dimWhite,
        }),
      ),
    );
    renderer.requestRender();

    renderer.addInputHandler((sequence: string) => {
      if (sequence === 'q') {
        renderer.destroy();
        process.exit(0);
      }
      return false;
    });
  }
}

