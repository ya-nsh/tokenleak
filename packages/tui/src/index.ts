import { Box, Text, createCliRenderer } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { COLORS, BOLD } from './lib/theme.js';
import {
  loadAllData,
  getDailyForWindow,
  ensureAdvisorReport,
  ensureFocusReport,
  ensureExplainReport,
  ensureCompareOutput,
} from './lib/data.js';
import { createInitialState, WINDOW_LABELS } from './lib/state.js';
import type { AppState, ViewMode } from './lib/state.js';
import { buildHeader } from './panels/header.js';
import { createChartPanel } from './panels/chart-panel.js';
import { createStatsRow } from './panels/stats-row.js';
import { createModelList } from './panels/model-list.js';
import { buildStatusBar } from './panels/status-bar.js';
import { createBloombergView } from './panels/bloomberg.js';
import { createAdvisorPanel } from './panels/advisor.js';
import { createFocusPanel } from './panels/focus.js';
import { createExplainPanel } from './panels/explain.js';
import { createComparePanel } from './panels/compare.js';

function clearRoot(renderer: CliRenderer): void {
  const children = renderer.root.getChildren();
  for (const child of children) {
    renderer.root.remove(child.id);
  }
}

function buildContent(state: AppState) {
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
    case 'bloomberg':
      return createBloombergView(state);
    case 'advisor':
      return createAdvisorPanel(state, ensureAdvisorReport(state));
    case 'focus':
      return createFocusPanel(state, ensureFocusReport(state));
    case 'explain':
      return createExplainPanel(ensureExplainReport(state), state.explainDate);
    case 'compare':
      return createComparePanel(state, ensureCompareOutput(state));
    default:
      return Box({ flexDirection: 'column', width: '100%', flexGrow: 1 });
  }
}

function buildLayout(state: AppState, renderer: CliRenderer) {
  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      backgroundColor: COLORS.bg,
    },
    buildHeader(state, renderer),
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
}

/** Null all caches (used on refresh) */
function invalidateAllCaches(state: AppState): void {
  state.cachedAdvisorReport = null;
  state.cachedFocusReport = null;
  state.cachedExplainReport = null;
  state.cachedCompareOutput = null;
}

/** Navigate explain date forward or backward by one day */
function shiftExplainDate(state: AppState, direction: number): void {
  if (!state.explainDate) return;
  const d = new Date(state.explainDate + 'T00:00:00');
  d.setDate(d.getDate() + direction);
  state.explainDate = d.toISOString().slice(0, 10);
  state.cachedExplainReport = null;
}

const VIEW_KEYS: Record<string, ViewMode> = {
  '1': 'overview',
  '2': 'bloomberg',
  '3': 'advisor',
  '4': 'focus',
  '5': 'explain',
  '6': 'compare',
};

/** Views that support j/k scrolling and their scroll offset field */
const SCROLLABLE_VIEWS = new Set<ViewMode>(['advisor', 'focus', 'compare']);

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
    default:
      return 0;
  }
}

function getVisibleCount(view: ViewMode): number {
  switch (view) {
    case 'advisor': return 10;
    case 'focus': return 12;
    case 'compare': return 6;
    default: return 10;
  }
}

function getScrollOffset(state: AppState): number {
  switch (state.selectedView) {
    case 'advisor': return state.advisorScrollOffset;
    case 'focus': return state.focusScrollOffset;
    case 'compare': return state.compareScrollOffset;
    default: return 0;
  }
}

function setScrollOffset(state: AppState, value: number): void {
  switch (state.selectedView) {
    case 'advisor': state.advisorScrollOffset = value; break;
    case 'focus': state.focusScrollOffset = value; break;
    case 'compare': state.compareScrollOffset = value; break;
  }
}

async function main(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: COLORS.bg,
  });

  const state = createInitialState();

  // Show loading state immediately
  render(state, renderer);

  try {
    const data = await loadAllData();
    state.data = data;
    state.isLoading = false;
    render(state, renderer);

    renderer.addInputHandler((sequence: string) => {
      // Tab / Right arrow: next time window
      if (sequence === '\t' || sequence === '\x1b[C') {
        state.selectedWindowIndex = (state.selectedWindowIndex + 1) % WINDOW_LABELS.length;
        state.modelScrollOffset = 0;
        invalidateWindowCaches(state);
        render(state, renderer);
        return true;
      }

      // Shift+Tab / Left arrow: prev time window
      if (sequence === '\x1b[Z' || sequence === '\x1b[D') {
        state.selectedWindowIndex =
          (state.selectedWindowIndex - 1 + WINDOW_LABELS.length) % WINDOW_LABELS.length;
        state.modelScrollOffset = 0;
        invalidateWindowCaches(state);
        render(state, renderer);
        return true;
      }

      // 1-6: switch view
      const viewMode = VIEW_KEYS[sequence];
      if (viewMode) {
        if (state.selectedView !== viewMode) {
          state.selectedView = viewMode;
          // Reset scroll offsets for the new view
          state.modelScrollOffset = 0;
          state.advisorScrollOffset = 0;
          state.focusScrollOffset = 0;
          state.compareScrollOffset = 0;
        }
        render(state, renderer);
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
        render(state, renderer);

        loadAllData()
          .then((freshData) => {
            state.data = freshData;
            state.isLoading = false;
            state.modelScrollOffset = 0;
            state.advisorScrollOffset = 0;
            state.focusScrollOffset = 0;
            state.compareScrollOffset = 0;
            state.explainDate = null;
            render(state, renderer);
          })
          .catch(() => {
            state.isLoading = false;
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

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
