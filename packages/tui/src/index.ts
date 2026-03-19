import { Box, Text, createCliRenderer } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { COLORS, BOLD } from './lib/theme.js';
import { loadAllData, getDailyForWindow } from './lib/data.js';
import { createInitialState, WINDOW_LABELS } from './lib/state.js';
import type { AppState } from './lib/state.js';
import { buildHeader } from './panels/header.js';
import { createChartPanel } from './panels/chart-panel.js';
import { createStatsRow } from './panels/stats-row.js';
import { createModelList } from './panels/model-list.js';
import { buildStatusBar } from './panels/status-bar.js';
import { createBloombergView } from './panels/bloomberg.js';

function clearRoot(renderer: CliRenderer): void {
  const children = renderer.root.getChildren();
  for (const child of children) {
    renderer.root.remove(child.id);
  }
}

function buildLayout(state: AppState, renderer: CliRenderer) {
  const windowStats = state.data?.windows[state.selectedWindowIndex]?.stats ?? null;
  const daily = state.data ? getDailyForWindow(state.data, state.selectedWindowIndex) : [];

  const content =
    state.selectedView === 'overview'
      ? Box(
          { flexDirection: 'column', width: '100%', flexGrow: 1 },
          createChartPanel(state, daily),
          createStatsRow(state, windowStats),
          createModelList(state, windowStats),
        )
      : createBloombergView(state);

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      backgroundColor: COLORS.bg,
    },
    buildHeader(state, renderer),
    content,
    buildStatusBar(state),
  );
}

function render(state: AppState, renderer: CliRenderer): void {
  clearRoot(renderer);
  renderer.root.add(buildLayout(state, renderer));
  renderer.requestRender();
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
        render(state, renderer);
        return true;
      }

      // Shift+Tab / Left arrow: prev time window
      if (sequence === '\x1b[Z' || sequence === '\x1b[D') {
        state.selectedWindowIndex =
          (state.selectedWindowIndex - 1 + WINDOW_LABELS.length) % WINDOW_LABELS.length;
        state.modelScrollOffset = 0;
        render(state, renderer);
        return true;
      }

      // 1: overview view
      if (sequence === '1') {
        state.selectedView = 'overview';
        render(state, renderer);
        return true;
      }

      // 2: bloomberg view
      if (sequence === '2') {
        state.selectedView = 'bloomberg';
        render(state, renderer);
        return true;
      }

      // j / Down: scroll model list down
      if ((sequence === 'j' || sequence === '\x1b[B') && state.selectedView === 'overview') {
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

      // k / Up: scroll model list up
      if ((sequence === 'k' || sequence === '\x1b[A') && state.selectedView === 'overview') {
        if (state.modelScrollOffset > 0) {
          state.modelScrollOffset--;
          render(state, renderer);
        }
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
        render(state, renderer);

        loadAllData()
          .then((freshData) => {
            state.data = freshData;
            state.isLoading = false;
            state.modelScrollOffset = 0;
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
