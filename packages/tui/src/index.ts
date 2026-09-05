import { refreshQuotas, startQuotaPolling } from './lib/quotas.js';
import { createQuotasPanel } from './panels/quotas.js';
import { Box, Text, createCliRenderer } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import type { TokenleakOutput } from '@tokenleak/core';
import {
  buildCommonsExport,
  buildCommonsPromptExport,
  getTodayLocal,
} from '@tokenleak/core';
import {
  CursorAuthError,
  resolveCursorSetupStatus,
  saveCursorCredentials,
  validateCursorSession,
} from '@tokenleak/registry';
import { computeAchievements, startReplayLiveServer } from '@tokenleak/renderers';
import { copyTextToClipboard } from './lib/clipboard.js';
import { COLORS, BOLD } from './lib/theme.js';
import {
  loadAllData,
  loadNutritionOutcomeSignalsForWindow,
  readCachedTuiData,
  writeCachedTuiData,
  getDailyForWindow,
  ensureAdvisorReport,
  ensureFocusReport,
  ensureExplainReport,
  ensureCompareOutput,
  ensureMoreStats,
  ensureReplayReport,
  ensureWasteReport,
  ensureAgentWasteReport,
  ensureRoutingSimulationReport,
  ensureAgentBehaviorDiffReport,
  ensureNutritionReport,
  ensureReceipt,
  deriveReceiptLines,
  getScopedWindowData,
  buildTokenleakOutput,
} from './lib/data.js';
import { createInitialState, WINDOW_LABELS, WINDOW_DAYS } from './lib/state.js';
import type { AppState, ViewMode } from './lib/state.js';
import { buildHeader } from './panels/header.js';
import { createChartPanel } from './panels/chart-panel.js';
import { createStatsRow } from './panels/stats-row.js';
import { createModelList } from './panels/model-list.js';
import { buildStatusBar } from './panels/status-bar.js';
import { createMatrixView } from './panels/bloomberg.js';
import { ADVISOR_VISIBLE_ITEMS, createAdvisorPanel } from './panels/advisor.js';
import { createFocusPanel } from './panels/focus.js';
import { createExplainPanel } from './panels/explain.js';
import { createComparePanel } from './panels/compare.js';
import { createExportPanel } from './panels/export.js';
import { createWrappedPanel } from './panels/wrapped.js';
import { createHelpPanel } from './panels/help.js';
import {
  createReplayPanel,
  REPLAY_MAX_CONTENT_WIDTH,
  REPLAY_VISIBLE_BLOCKS,
  REPLAY_VISIBLE_BLOCKS_PLAYBACK,
} from './panels/replay.js';
import type { ReplayPlaybackView } from './panels/replay.js';
import {
  REPLAY_PLAYBACK_TICK_MS,
  computePlaybackSummary,
  enterReplayPlayback,
  exitReplayPlayback,
  jumpReplayCursorToBlockBoundary,
  jumpReplayCursorToInteresting,
  setReplayPlaybackSpeed,
  selectReplayCursorEvent,
  stepReplayCursor,
  tickReplayPlayback,
  toggleReplayPlayback,
} from './lib/replay-playback.js';
import {
  buildReplayLiveDataProvider,
  keepReplaySelectionVisible,
  moveReplayOverviewSelection,
  resetReplayDataInteraction,
  resetReplayPanelInteraction,
} from './lib/replay-interaction.js';
import type { ReplayPlaybackSpeed } from './lib/state.js';
import { createNutritionPanel, NUTRITION_VISIBLE_ROWS } from './panels/nutrition.js';
import { createReceiptsPanel, RECEIPTS_MAX_CONTENT_WIDTH, RECEIPTS_VISIBLE_ROWS } from './panels/receipts.js';
import { createSimulatorPanel, SIMULATOR_MAX_CONTENT_WIDTH, SIMULATOR_VISIBLE_ROWS } from './panels/simulator.js';
import { createWastePanel, WASTE_MAX_CONTENT_WIDTH, WASTE_VISIBLE_ROWS } from './panels/waste.js';
import { createBehaviorPanel } from './panels/behavior.js';
import { buildCursorBanner, createCursorSetupPanel, isEscapeKeySequence } from './panels/cursor-setup.js';

const CURSOR_SETUP_LABEL_INPUT_ID = 'cursor-setup-label-input';
const CURSOR_SETUP_TOKEN_INPUT_ID = 'cursor-setup-token-input';

function clearRoot(renderer: CliRenderer): void {
  const children = renderer.root.getChildren();
  for (const child of children) {
    renderer.root.remove(child.id);
  }
}

function createDeferredPanel(title: string, message: string, isError: boolean = false) {
  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: isError ? COLORS.red : COLORS.dimWhite,
      paddingLeft: 1,
      paddingRight: 1,
    },
    Text({ content: ` ${title} `, fg: isError ? COLORS.red : COLORS.amber, attributes: BOLD }),
    Text({ content: '', fg: COLORS.dimWhite }),
    Text({ content: message, fg: isError ? COLORS.red : COLORS.dimWhite }),
  );
}

function clearViewTaskState(state: AppState): void {
  state.viewTasks.pendingKeys.clear();
  state.viewTasks.errors = {};
  state.viewTasks.activeLabel = null;
}

function windowTaskKey(state: AppState): string {
  const window = state.data?.windows[state.selectedWindowIndex];
  if (!window) {
    return `window:${state.selectedWindowIndex}`;
  }

  return `${state.selectedWindowIndex}:${window.dateRange.since}..${window.dateRange.until}`;
}

function ensureExplainDate(state: AppState): string {
  if (!state.explainDate) {
    const windowStats = state.data?.windows[state.selectedWindowIndex]?.stats;
    state.explainDate = windowStats?.peakDay?.date ?? new Date().toISOString().slice(0, 10);
  }

  return state.explainDate;
}

function getSelectedViewTaskKey(state: AppState, view: ViewMode = state.selectedView): string {
  const base = windowTaskKey(state);
  switch (view) {
    case 'advisor':
      return `advisor:${base}`;
    case 'focus':
      return `focus:${base}`;
    case 'explain':
      return `explain:${base}:${ensureExplainDate(state)}`;
    case 'compare':
      return `compare:${base}`;
    case 'matrix':
      return `matrix-more:${base}:page-${state.matrixPage}`;
    case 'wrapped':
      return `wrapped:${base}`;
    case 'replay':
      return `replay:${base}:${state.replayDate ?? new Date().toISOString().slice(0, 10)}`;
    case 'nutrition':
      return `nutrition:${base}`;
    case 'receipts':
      return `receipts:${base}`;
    case 'simulator':
      return `simulator:${base}`;
    case 'waste':
      return `waste:${base}`;
    case 'behavior':
      return `behavior:${base}`;
    default:
      return `${view}:${base}`;
  }
}

function scheduleViewTask(
  state: AppState,
  renderer: CliRenderer,
  key: string,
  label: string,
  compute: () => Promise<void> | void,
): void {
  if (state.viewTasks.pendingKeys.has(key)) {
    state.viewTasks.activeLabel = label;
    return;
  }

  state.viewTasks.pendingKeys.add(key);
  delete state.viewTasks.errors[key];
  state.viewTasks.activeLabel = label;

  setTimeout(() => {
    void (async () => {
      try {
        if (getSelectedViewTaskKey(state) !== key) {
          return;
        }

        await compute();
      } catch (error: unknown) {
        state.viewTasks.errors[key] = error instanceof Error ? error.message : String(error);
      } finally {
        state.viewTasks.pendingKeys.delete(key);
        if (getSelectedViewTaskKey(state) === key) {
          state.viewTasks.activeLabel = null;
          render(state, renderer);
        }
      }
    })();
  }, 0);
}

function deferredPanelForTask(
  state: AppState,
  renderer: CliRenderer,
  key: string,
  label: string,
  compute: () => Promise<void> | void,
) {
  const error = state.viewTasks.errors[key];
  if (error) {
    return createDeferredPanel(label, `Could not load ${label}: ${error}`, true);
  }

  scheduleViewTask(state, renderer, key, label, compute);
  return createDeferredPanel(label, `Loading ${label}...`);
}

function nutritionWindowKey(state: AppState): string | null {
  const window = state.data?.windows[state.selectedWindowIndex];
  return window ? `${window.dateRange.since}..${window.dateRange.until}` : null;
}

function buildContent(state: AppState, renderer: CliRenderer) {
  if (state.showCursorSetup) {
    const { panel, labelInput, tokenInput } = createCursorSetupPanel(state, renderer, {
      onFieldFocus: (field) => {
        state.cursorSetupField = field;
      },
      onLabelInput: (value) => {
        state.cursorSetupLabel = value;
      },
      onTokenInput: (value) => {
        state.cursorSetupToken = value;
      },
      onSubmit: () => {
        void submitCursorSetup(state, renderer);
      },
      onCancel: () => {
        closeCursorSetup(state);
        render(state, renderer);
      },
    });

    labelInput.id = CURSOR_SETUP_LABEL_INPUT_ID;
    tokenInput.id = CURSOR_SETUP_TOKEN_INPUT_ID;

    return panel;
  }

  // Help overlay takes priority
  if (state.showHelp) {
    return createHelpPanel();
  }

  const windowStats = state.data?.windows[state.selectedWindowIndex]?.stats ?? null;
  const daily = state.data ? getDailyForWindow(state.data, state.selectedWindowIndex) : [];
  const hasWindowData = Boolean(state.data?.windows[state.selectedWindowIndex]);

  if (state.selectedView === 'quotas') {
    return createQuotasPanel(state, renderer.width, renderer.height);
  }

  if (!state.data && state.loadError) {
    return createDeferredPanel('Refresh failed', state.loadError, true);
  }

  if (!state.data && state.selectedView !== 'overview' && state.selectedView !== 'export') {
    return createDeferredPanel('Loading', 'Loading usage data...');
  }

  switch (state.selectedView) {
    case 'overview':
      return Box(
        { flexDirection: 'column', width: '100%', flexGrow: 1 },
        createChartPanel(state, daily),
        createStatsRow(state, windowStats),
        createModelList(state, windowStats),
      );
    case 'matrix':
      if (hasWindowData && state.matrixPage > 0 && !state.cachedMoreStats) {
        const key = getSelectedViewTaskKey(state, 'matrix');
        return deferredPanelForTask(state, renderer, key, 'Matrix', () => {
          ensureMoreStats(state);
        });
      }
      return createMatrixView(state);
    case 'advisor':
      if (!hasWindowData) {
        return createAdvisorPanel(state, null, null);
      }
      if (!state.cachedAdvisorReport || !state.cachedWasteReport) {
        const key = getSelectedViewTaskKey(state, 'advisor');
        return deferredPanelForTask(state, renderer, key, 'Advisor', () => {
          ensureAdvisorReport(state);
          ensureWasteReport(state);
        });
      }
      return createAdvisorPanel(state, state.cachedAdvisorReport, state.cachedWasteReport);
    case 'focus':
      if (!hasWindowData) {
        return createFocusPanel(state, null);
      }
      if (!state.cachedFocusReport) {
        const key = getSelectedViewTaskKey(state, 'focus');
        return deferredPanelForTask(state, renderer, key, 'Focus Sessions', () => {
          ensureFocusReport(state);
        });
      }
      return createFocusPanel(state, state.cachedFocusReport);
    case 'explain':
      if (!hasWindowData) {
        return createExplainPanel(null, state.explainDate);
      }
      ensureExplainDate(state);
      if (!state.cachedExplainReport || state.cachedExplainReport.date !== state.explainDate) {
        const key = getSelectedViewTaskKey(state, 'explain');
        return deferredPanelForTask(state, renderer, key, 'Explain', () => {
          ensureExplainReport(state);
        });
      }
      return createExplainPanel(state.cachedExplainReport, state.explainDate);
    case 'compare':
      if (!hasWindowData) {
        return createComparePanel(state, null);
      }
      if (!state.cachedCompareOutput) {
        const key = getSelectedViewTaskKey(state, 'compare');
        return deferredPanelForTask(state, renderer, key, 'Compare', () => {
          ensureCompareOutput(state);
        });
      }
      return createComparePanel(state, state.cachedCompareOutput);
    case 'export':
      return createExportPanel(state);
    case 'replay':
      if (!hasWindowData) {
        return createReplayPanel(
          null,
          state.replayDate,
          state.replaySelectedBlockIndex,
          state.replayExpandedBlockIndex,
          state.replayScrollOffset,
          getPanelContentWidth(renderer, REPLAY_MAX_CONTENT_WIDTH),
          undefined,
          null,
        );
      }
      if (!state.replayDate) {
        state.replayDate = new Date().toISOString().slice(0, 10);
      }
      if (!state.cachedReplayReport || state.cachedReplayReport.date !== state.replayDate) {
        const key = getSelectedViewTaskKey(state, 'replay');
        return deferredPanelForTask(state, renderer, key, 'Replay', () => {
          ensureReplayReport(state);
        });
      }
      return createReplayPanel(
        state.cachedReplayReport,
        state.replayDate,
        state.replaySelectedBlockIndex,
        state.replayExpandedBlockIndex,
        state.replayScrollOffset,
        getPanelContentWidth(renderer, REPLAY_MAX_CONTENT_WIDTH),
        (blockIndex) => {
          toggleReplayBlock(state, blockIndex);
          render(state, renderer);
        },
        buildReplayPlaybackView(state),
      );
    case 'nutrition':
      if (!hasWindowData) {
        return createNutritionPanel(state, null);
      }
      if (!state.cachedNutritionReport) {
        const key = getSelectedViewTaskKey(state, 'nutrition');
        return deferredPanelForTask(state, renderer, key, 'AI ROI', async () => {
          state.nutritionSignalsLoading = true;
          try {
            const signals = await loadNutritionOutcomeSignalsForWindow(state);
            if (getSelectedViewTaskKey(state, 'nutrition') !== key) {
              return;
            }
            const window = state.data?.windows[state.selectedWindowIndex];
            if (window) {
              window.nutritionOutcomeSignals = signals;
            }
            state.cachedNutritionReport = null;
            const signalKey = nutritionWindowKey(state);
            if (signalKey) {
              state.nutritionSignalsLoadedKeys.add(signalKey);
            }
            ensureNutritionReport(state);
          } finally {
            state.nutritionSignalsLoading = false;
          }
        });
      }
      return createNutritionPanel(state, state.cachedNutritionReport);
    case 'wrapped': {
      if (hasWindowData && !state.cachedMoreStats) {
        const key = getSelectedViewTaskKey(state, 'wrapped');
        return deferredPanelForTask(state, renderer, key, 'Wrapped', () => {
          ensureMoreStats(state);
        });
      }
      const output = buildTokenleakOutput(state, { computeMore: false });
      const achievements = output ? computeAchievements(output) : [];
      const providers =
        (output?.providers ?? []).map((p) => ({
          displayName: p.displayName,
          totalTokens: p.totalTokens,
          totalCost: p.totalCost,
          costCompleteness: p.costCompleteness,
        })) ?? [];
      return createWrappedPanel(
        windowStats,
        achievements,
        providers,
        state.wrappedScrollOffset,
        state.cachedMoreStats,
      );
    }
    case 'receipts':
      if (!hasWindowData) {
        return createReceiptsPanel(state, null, getPanelContentWidth(renderer, RECEIPTS_MAX_CONTENT_WIDTH));
      }
      if (!state.cachedReceipt) {
        const key = getSelectedViewTaskKey(state, 'receipts');
        return deferredPanelForTask(state, renderer, key, 'Receipts', () => {
          ensureReceipt(state);
        });
      }
      return createReceiptsPanel(
        state,
        state.cachedReceipt,
        getPanelContentWidth(renderer, RECEIPTS_MAX_CONTENT_WIDTH),
        (lineIndex) => {
          toggleReceiptLine(state, lineIndex);
          render(state, renderer);
        },
      );
    case 'simulator':
      if (!hasWindowData) {
        return createSimulatorPanel(null);
      }
      if (!state.cachedRoutingSimulationReport) {
        const key = getSelectedViewTaskKey(state, 'simulator');
        return deferredPanelForTask(state, renderer, key, 'Routing Simulator', () => {
          ensureRoutingSimulationReport(state);
        });
      }
      return createSimulatorPanel(
        state.cachedRoutingSimulationReport,
        state.simulatorScrollOffset,
        getPanelContentWidth(renderer, SIMULATOR_MAX_CONTENT_WIDTH),
      );
    case 'waste':
      if (!hasWindowData) {
        return createWastePanel(null);
      }
      if (!state.cachedAgentWasteReport) {
        const key = getSelectedViewTaskKey(state, 'waste');
        return deferredPanelForTask(state, renderer, key, 'Waste Signals', () => {
          ensureAgentWasteReport(state);
        });
      }
      return createWastePanel(
        state.cachedAgentWasteReport,
        state.wasteScrollOffset,
        getPanelContentWidth(renderer, WASTE_MAX_CONTENT_WIDTH),
      );
    case 'behavior':
      if (!hasWindowData) {
        return createBehaviorPanel(null);
      }
      if (!state.cachedBehaviorDiffReport) {
        const key = getSelectedViewTaskKey(state, 'behavior');
        return deferredPanelForTask(state, renderer, key, 'Behavior Diff', () => {
          ensureAgentBehaviorDiffReport(state);
        });
      }
      return createBehaviorPanel(state.cachedBehaviorDiffReport);
    default:
      return Box({ flexDirection: 'column', width: '100%', flexGrow: 1 });
  }
}

function buildWindowScopedTokenleakOutput(state: AppState): TokenleakOutput | null {
  return buildTokenleakOutput(state, { computeMore: true });
}

function resetCursorSetupForm(state: AppState): void {
  state.cursorSetupField = 'token';
  state.cursorSetupLabel = '';
  state.cursorSetupToken = '';
  state.cursorSetupMessage = null;
  state.cursorSetupSubmitting = false;
}

function openCursorSetup(state: AppState): void {
  state.showCursorSetup = true;
  state.showHelp = false;
  state.cursorSetupField = 'token';
  state.cursorSetupMessage = null;
}

function closeCursorSetup(state: AppState): void {
  state.showCursorSetup = false;
  state.cursorSetupMessage = null;
  state.cursorSetupSubmitting = false;
}

function applyLoadedData(
  state: AppState,
  freshData: Awaited<ReturnType<typeof loadAllData>>,
): void {
  state.data = freshData;
  state.isLoading = false;
  state.loadError = null;
  state.modelScrollOffset = 0;
  state.advisorScrollOffset = 0;
  state.focusScrollOffset = 0;
  state.nutritionScrollOffset = 0;
  state.compareScrollOffset = 0;
  state.wrappedScrollOffset = 0;
  resetReplayDataState(state);
  state.replayDate = null;
  state.explainDate = null;
  state.receiptsScrollOffset = 0;
  state.receiptsSelectedLineIndex = 0;
  state.receiptsExpandedLineIndex = null;
  state.receiptsSortMode = 'cost';
  state.receiptsCategoryFilter = null;
  state.simulatorScrollOffset = 0;
  state.wasteScrollOffset = 0;
  state.behaviorScrollOffset = 0;
  state.nutritionSignalsLoading = false;
  state.nutritionSignalsLoadedKeys.clear();
  clearViewTaskState(state);
  // Fresh TUI data now carries the latest cursorSetupStatus, so the override can be cleared.
  state.cursorSetupStatusOverride = null;
}

async function reloadAllData(
  state: AppState,
  renderer: CliRenderer,
  failurePrefix?: string,
): Promise<void> {
  state.isLoading = true;
  state.loadError = null;
  invalidateAllCaches(state);
  state.exportStatus = null;
  render(state, renderer);

  try {
    const freshData = await loadAllData({ attemptCursorSync: true });
    applyLoadedData(state, freshData);
    writeCachedTuiData(freshData);
  } catch (err: unknown) {
    state.isLoading = false;
    state.loadError = `${failurePrefix ?? 'Refresh failed'}: ${err instanceof Error ? err.message : String(err)}`;
  }

  render(state, renderer);
}

async function submitCursorSetup(state: AppState, renderer: CliRenderer): Promise<void> {
  if (state.cursorSetupSubmitting) {
    return;
  }

  state.cursorSetupSubmitting = true;
  state.cursorSetupMessage = null;
  render(state, renderer);

  try {
    const token = state.cursorSetupToken.trim();
    const label = state.cursorSetupLabel.trim() || undefined;

    if (token) {
      const validation = await validateCursorSession(token);
      if (!validation.valid) {
        throw new CursorAuthError(validation.error ?? 'Invalid session token', validation.reason);
      }

      saveCursorCredentials(token, label);
    }

    const status = await resolveCursorSetupStatus({ attemptSync: true });
    state.cursorSetupStatusOverride = status;

    if (status.state === 'ready') {
      resetCursorSetupForm(state);
      closeCursorSetup(state);
      await reloadAllData(state, renderer, 'Cursor reload failed');
      return;
    }

    if (!token && status.state === 'needs_auth') {
      throw new CursorAuthError('Enter a Cursor session token to continue.');
    }

    state.cursorSetupMessage = status.error ?? 'Cursor setup still needs attention.';
  } catch (err: unknown) {
    state.cursorSetupMessage = err instanceof Error ? err.message : String(err);
  } finally {
    state.cursorSetupSubmitting = false;
    render(state, renderer);
  }
}

function handleCursorSetupInput(sequence: string, state: AppState, renderer: CliRenderer): boolean {
  if (!state.showCursorSetup) {
    return false;
  }

  if (isEscapeKeySequence(sequence)) {
    closeCursorSetup(state);
    render(state, renderer);
    return true;
  }

  if (state.cursorSetupSubmitting) {
    return true;
  }

  if (sequence === '\t' || sequence === '\x1b[Z') {
    state.cursorSetupField = state.cursorSetupField === 'token' ? 'label' : 'token';
    render(state, renderer);
    return true;
  }

  return false;
}

function tryOpenCursorSetup(state: AppState, renderer: CliRenderer): boolean {
  resetCursorSetupForm(state);
  openCursorSetup(state);
  render(state, renderer);
  return true;
}

let currentState: AppState;
let currentRenderer: CliRenderer;

function getPanelContentWidth(renderer: CliRenderer, maxWidth: number): number {
  return Math.max(1, Math.min(maxWidth, renderer.terminalWidth - 4));
}

function clampItemIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(index, itemCount - 1));
}

function keepSelectedItemVisible(selectedIndex: number, scrollOffset: number, visibleCount: number): number {
  if (selectedIndex < scrollOffset) {
    return selectedIndex;
  }
  if (selectedIndex >= scrollOffset + visibleCount) {
    return selectedIndex - visibleCount + 1;
  }
  return scrollOffset;
}

let replayPlaybackTimer: ReturnType<typeof setInterval> | null = null;

function startReplayPlaybackTimer(): void {
  if (replayPlaybackTimer !== null) return;
  replayPlaybackTimer = setInterval(() => {
    if (!currentState.replayPlaybackActive) {
      stopReplayPlaybackTimer();
      return;
    }
    const advanced = tickReplayPlayback(currentState);
    keepReplaySelectionVisible(currentState, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
    if (!advanced) {
      stopReplayPlaybackTimer();
    }
    render(currentState, currentRenderer);
  }, REPLAY_PLAYBACK_TICK_MS);
}

function resetReplayPanelState(state: AppState): void {
  resetReplayPanelInteraction(state, stopReplayPlaybackTimer);
}

function resetReplayDataState(state: AppState): void {
  resetReplayDataInteraction(state, stopReplayPlaybackTimer, stopReplayLiveServer);
}

function stopReplayPlaybackTimer(): void {
  if (replayPlaybackTimer !== null) {
    clearInterval(replayPlaybackTimer);
    replayPlaybackTimer = null;
  }
}

/**
 * Replay playback / step-mode keyboard dispatch. Returns true when the
 * sequence was consumed. Activates only on the replay view.
 *
 * Mode entry/exit is bound to `s` so the rest of the TUI's keymap is
 * unaffected. Once in playback mode we intercept playback-specific keys
 * (n/p step, N/P block, i/I interesting, space play/pause, 1/2/3 speed,
 * Home/End jump, Esc exit) and let everything else (q, view switches,
 * date shift via h/l, j/k block selection) fall through to the regular
 * handlers downstream.
 */
function handleReplayPlaybackInput(
  sequence: string,
  state: AppState,
  renderer: CliRenderer,
): boolean {
  if (state.selectedView !== 'replay') return false;
  const events = state.cachedReplayReport?.events;

  // Toggle entry from overview mode.
  if (state.replayCursorEventIndex === null) {
    if (sequence === 's' && events && events.length > 0) {
      enterReplayPlayback(state);
      keepReplaySelectionVisible(state, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
      render(state, renderer);
      return true;
    }
    return false;
  }

  // We're in playback mode from here on.
  if (!events || events.length === 0) {
    exitReplayPlayback(state);
    stopReplayPlaybackTimer();
    render(state, renderer);
    return true;
  }

  // Exit
  if (sequence === 's' || isEscapeKeySequence(sequence)) {
    exitReplayPlayback(state);
    stopReplayPlaybackTimer();
    render(state, renderer);
    return true;
  }

  // Step controls
  if (sequence === 'n' || sequence === '\x1b[C') {
    pauseReplayPlaybackIfRunning(state);
    stepReplayCursor(state, 1);
    keepReplaySelectionVisible(state, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
    render(state, renderer);
    return true;
  }
  if (sequence === 'p' || sequence === '\x1b[D') {
    pauseReplayPlaybackIfRunning(state);
    stepReplayCursor(state, -1);
    keepReplaySelectionVisible(state, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
    render(state, renderer);
    return true;
  }
  if (sequence === 'N') {
    pauseReplayPlaybackIfRunning(state);
    jumpReplayCursorToBlockBoundary(state, 1);
    keepReplaySelectionVisible(state, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
    render(state, renderer);
    return true;
  }
  if (sequence === 'P') {
    pauseReplayPlaybackIfRunning(state);
    jumpReplayCursorToBlockBoundary(state, -1);
    keepReplaySelectionVisible(state, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
    render(state, renderer);
    return true;
  }
  if (sequence === 'i') {
    pauseReplayPlaybackIfRunning(state);
    jumpReplayCursorToInteresting(state, 1);
    keepReplaySelectionVisible(state, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
    render(state, renderer);
    return true;
  }
  if (sequence === 'I') {
    pauseReplayPlaybackIfRunning(state);
    jumpReplayCursorToInteresting(state, -1);
    keepReplaySelectionVisible(state, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
    render(state, renderer);
    return true;
  }
  if (sequence === '\x1b[H' || sequence === '\x1bOH') {
    pauseReplayPlaybackIfRunning(state);
    selectReplayCursorEvent(state, 0);
    keepReplaySelectionVisible(state, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
    render(state, renderer);
    return true;
  }
  if (sequence === '\x1b[F' || sequence === '\x1bOF') {
    pauseReplayPlaybackIfRunning(state);
    selectReplayCursorEvent(state, events.length - 1);
    keepReplaySelectionVisible(state, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
    render(state, renderer);
    return true;
  }

  // Play / pause
  if (sequence === ' ') {
    const active = toggleReplayPlayback(state);
    if (active) {
      // If we're at the end, restart from the beginning.
      if (state.replayCursorEventIndex! >= events.length - 1) {
        selectReplayCursorEvent(state, 0);
        keepReplaySelectionVisible(state, REPLAY_VISIBLE_BLOCKS_PLAYBACK);
      }
      startReplayPlaybackTimer();
    } else {
      stopReplayPlaybackTimer();
    }
    render(state, renderer);
    return true;
  }

  // Speed selection
  if (sequence === '1' || sequence === '2' || sequence === '3') {
    const speedMap: Record<string, ReplayPlaybackSpeed> = { '1': 60, '2': 240, '3': 600 };
    setReplayPlaybackSpeed(state, speedMap[sequence]);
    render(state, renderer);
    return true;
  }

  // Pass through everything else (q, j/k, h/l, view switches, etc.)
  return false;
}

function pauseReplayPlaybackIfRunning(state: AppState): void {
  if (state.replayPlaybackActive) {
    state.replayPlaybackActive = false;
    stopReplayPlaybackTimer();
  }
}

// ── In-process replay live server (launched via global `o` keypress) ──

let replayLiveServerStop: (() => void) | null = null;

const OS_OPEN_COMMANDS: Record<string, string> = {
  darwin: 'open',
  linux: 'xdg-open',
  win32: 'start',
};

function openUrlInBrowser(url: string): void {
  const cmd = OS_OPEN_COMMANDS[process.platform];
  if (!cmd) return;
  const args = process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : [cmd, url];
  try {
    Bun.spawn(args, { stdout: 'ignore', stderr: 'ignore' });
  } catch {
    // best-effort; the in-TUI banner still shows the URL the user can open manually
  }
}

async function launchReplayBrowser(state: AppState, renderer: CliRenderer): Promise<void> {
  // Idempotent — second press just re-opens the browser to the existing server.
  if (state.replayLiveServerPort !== null) {
    openUrlInBrowser(`http://localhost:${state.replayLiveServerPort}/`);
    return;
  }
  if (!state.data) return; // still booting; nothing to render yet
  const scoped = getScopedWindowData(state);
  const providers = scoped?.scopedProviders ?? state.data.providers;
  const replayLiveData = buildReplayLiveDataProvider(providers, state.replayDate, getTodayLocal());
  state.replayDate = replayLiveData.initialDate;
  state.cachedReplayReport = replayLiveData.initialReport;
  try {
    // silent: true suppresses the server's stderr "Replay live at..." line,
    // which would otherwise corrupt the full-screen TUI render and make
    // the terminal look frozen until the user hits another key.
    const { port, stop } = await startReplayLiveServer(replayLiveData, { silent: true });
    state.replayLiveServerPort = port;
    replayLiveServerStop = stop;
    render(state, renderer);
    openUrlInBrowser(`http://localhost:${port}/`);
  } catch {
    // best-effort. The TUI render path doesn't have an error toast yet —
    // failing silently is safer than dumping to stderr (would corrupt
    // the screen).
  }
}

/**
 * Global [o] dispatcher — fires from any view, not just Replay. Lets the
 * footer CTA's keybind work everywhere in the TUI. Returns true when the
 * keypress was consumed.
 */
function handleGlobalReplayBrowserKey(
  sequence: string,
  state: AppState,
  renderer: CliRenderer,
): boolean {
  if (sequence !== 'o') return false;
  void launchReplayBrowser(state, renderer);
  return true;
}

function stopReplayLiveServer(state: AppState): void {
  if (replayLiveServerStop !== null) {
    try { replayLiveServerStop(); } catch { /* noop */ }
    replayLiveServerStop = null;
  }
  state.replayLiveServerPort = null;
}

function buildReplayPlaybackView(state: AppState): ReplayPlaybackView | null {
  const report = state.cachedReplayReport;
  if (!report || state.replayCursorEventIndex === null || report.events.length === 0) {
    return null;
  }
  const summary = computePlaybackSummary(report, state.replayCursorEventIndex);
  if (!summary) return null;
  const totalDayCost = report.events.reduce((s, e) => s + e.cost, 0);
  return {
    cursorIndex: summary.cursorIndex,
    active: state.replayPlaybackActive,
    speed: state.replayPlaybackSpeed,
    summary,
    totalDayCost,
  };
}


function resetReceiptsInteraction(state: AppState): void {
  state.receiptsScrollOffset = 0;
  state.receiptsSelectedLineIndex = 0;
  state.receiptsExpandedLineIndex = null;
}

function getReceiptLineCount(state: AppState): number {
  const receipt = state.cachedReceipt;
  if (!receipt) return 0;
  return deriveReceiptLines(receipt, state.receiptsSortMode, state.receiptsCategoryFilter).length;
}

function toggleReplayBlock(state: AppState, blockIndex: number = state.replaySelectedBlockIndex): void {
  if (state.replayCursorEventIndex !== null) return;
  const itemCount = state.cachedReplayReport?.flowBlocks.length ?? 0;
  if (itemCount <= 0) return;
  const selected = clampItemIndex(blockIndex, itemCount);
  state.replaySelectedBlockIndex = selected;
  state.replayScrollOffset = keepSelectedItemVisible(
    selected,
    state.replayScrollOffset,
    REPLAY_VISIBLE_BLOCKS,
  );
  state.replayExpandedBlockIndex = state.replayExpandedBlockIndex === selected ? null : selected;
}

function toggleReceiptLine(state: AppState, lineIndex: number = state.receiptsSelectedLineIndex): void {
  const itemCount = getReceiptLineCount(state);
  if (itemCount <= 0) return;
  const selected = clampItemIndex(lineIndex, itemCount);
  state.receiptsSelectedLineIndex = selected;
  state.receiptsScrollOffset = keepSelectedItemVisible(
    selected,
    state.receiptsScrollOffset,
    RECEIPTS_VISIBLE_ROWS,
  );
  state.receiptsExpandedLineIndex = state.receiptsExpandedLineIndex === selected ? null : selected;
}

function moveReplaySelection(state: AppState, direction: number): void {
  moveReplayOverviewSelection(state, direction, REPLAY_VISIBLE_BLOCKS);
}

function moveReceiptSelection(state: AppState, direction: number): void {
  const itemCount = getReceiptLineCount(state);
  if (itemCount <= 0) return;
  const selected = clampItemIndex(state.receiptsSelectedLineIndex + direction, itemCount);
  state.receiptsSelectedLineIndex = selected;
  state.receiptsScrollOffset = keepSelectedItemVisible(
    selected,
    state.receiptsScrollOffset,
    RECEIPTS_VISIBLE_ROWS,
  );
}

function handleViewSwitch(mode: ViewMode): void {
  if (mode === 'quotas') {
    void refreshQuotas(currentState).then(() => {
      if (!currentRenderer.isDestroyed) render(currentState, currentRenderer);
    });
  }
  if (currentState.selectedView !== mode) {
    currentState.selectedView = mode;
    currentState.modelScrollOffset = 0;
    currentState.advisorScrollOffset = 0;
    currentState.focusScrollOffset = 0;
    currentState.nutritionScrollOffset = 0;
    currentState.compareScrollOffset = 0;
    currentState.wrappedScrollOffset = 0;
    currentState.simulatorScrollOffset = 0;
    currentState.wasteScrollOffset = 0;
    currentState.behaviorScrollOffset = 0;
    resetReplayPanelState(currentState);
    resetReceiptsInteraction(currentState);
    currentState.receiptsSortMode = 'cost';
    currentState.receiptsCategoryFilter = null;
    currentState.viewTasks.activeLabel = null;
    // Reset matrix page when switching to matrix
    if (mode === 'matrix') {
      currentState.matrixPage = 0;
    }
  }
  render(currentState, currentRenderer);
}

function buildLayout(state: AppState, renderer: CliRenderer) {
  const cursorBanner = buildCursorBanner(state);
  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      backgroundColor: COLORS.bg,
    },
    buildHeader(state, renderer, handleViewSwitch),
    ...(cursorBanner ? [cursorBanner] : []),
    buildContent(state, renderer),
    buildStatusBar(state),
  );
}

function focusCursorSetupField(state: AppState, renderer: CliRenderer): void {
  if (!state.showCursorSetup) {
    return;
  }

  const targetId =
    state.cursorSetupField === 'label' ? CURSOR_SETUP_LABEL_INPUT_ID : CURSOR_SETUP_TOKEN_INPUT_ID;
  const target = renderer.root.findDescendantById(targetId);
  if (target) {
    target.focus();
  }
}

function render(state: AppState, renderer: CliRenderer): void {
  clearRoot(renderer);
  renderer.root.add(buildLayout(state, renderer));
  focusCursorSetupField(state, renderer);
  renderer.requestRender();
}

/** Null caches that depend on the selected window */
function invalidateWindowCaches(state: AppState): void {
  state.cachedAdvisorReport = null;
  state.cachedCompareOutput = null;
  state.cachedFocusReport = null;
  state.cachedExplainReport = null;
  state.cachedMoreStats = null;
  state.cachedReplayReport = null;
  state.cachedWasteReport = null;
  state.cachedNutritionReport = null;
  state.cachedReceipt = null;
  state.cachedRoutingSimulationReport = null;
  state.cachedAgentWasteReport = null;
  state.cachedBehaviorDiffReport = null;
  resetReceiptsInteraction(state);
  state.receiptsSortMode = 'cost';
  state.receiptsCategoryFilter = null;
  state.explainDate = null; // re-derive from new window's peak day
  state.replayDate = null;
  resetReplayDataState(state);
  clearViewTaskState(state);
}

/** Null all caches (used on refresh) */
function invalidateAllCaches(state: AppState): void {
  state.cachedAdvisorReport = null;
  state.cachedFocusReport = null;
  state.cachedExplainReport = null;
  state.cachedCompareOutput = null;
  state.cachedMoreStats = null;
  state.cachedReplayReport = null;
  state.cachedWasteReport = null;
  state.cachedNutritionReport = null;
  state.cachedReceipt = null;
  state.cachedRoutingSimulationReport = null;
  state.cachedAgentWasteReport = null;
  state.cachedBehaviorDiffReport = null;
  resetReplayDataState(state);
  resetReceiptsInteraction(state);
  state.nutritionSignalsLoading = false;
  state.nutritionSignalsLoadedKeys.clear();
  clearViewTaskState(state);
}

/** Navigate replay date forward or backward by one day */
function shiftReplayDate(state: AppState, direction: number): void {
  if (!state.replayDate) return;
  const d = new Date(state.replayDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + direction);
  state.replayDate = d.toISOString().slice(0, 10);
  state.cachedReplayReport = null;
  resetReplayDataState(state);
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
  U: 'quotas',
  '1': 'overview',
  '2': 'matrix',
  '3': 'advisor',
  '4': 'focus',
  '5': 'explain',
  '6': 'compare',
  '7': 'export',
  '8': 'wrapped',
  '9': 'replay',
  '0': 'nutrition',
  R: 'receipts',
  X: 'simulator',
  Y: 'waste',
  Z: 'behavior',
};

const VIEW_ORDER: ViewMode[] = [
  'overview',
  'quotas',
  'matrix',
  'advisor',
  'focus',
  'explain',
  'compare',
  'export',
  'wrapped',
  'replay',
  'nutrition',
  'receipts',
  'simulator',
  'waste',
  'behavior',
];

/** Views that support j/k scrolling and their scroll offset field */
const SCROLLABLE_VIEWS = new Set<ViewMode>([
  'advisor',
  'focus',
  'compare',
  'wrapped',
  'replay',
  'nutrition',
  'receipts',
  'simulator',
  'waste',
  'behavior',
]);

function getScrollableItemCount(state: AppState): number {
  switch (state.selectedView) {
    case 'advisor':
      return (
        (state.cachedAdvisorReport?.recommendations.length ?? 0) +
        (state.cachedWasteReport?.findings.length ?? 0)
      );
    case 'focus':
      return Math.min(state.cachedFocusReport?.entries.length ?? 0, 20);
    case 'compare':
      return 6; // fixed metric rows
    case 'wrapped':
      return 30; // approximate content rows
    case 'replay':
      return state.cachedReplayReport?.flowBlocks.length ?? 0;
    case 'nutrition':
      return Math.min(state.cachedNutritionReport?.repos.length ?? 0, 30);
    case 'receipts': {
      return getReceiptLineCount(state);
    }
    case 'simulator':
      return state.cachedRoutingSimulationReport?.candidates.length ?? 0;
    case 'waste':
      return state.cachedAgentWasteReport?.signals.length ?? 0;
    case 'behavior':
      return 12;
    default:
      return 0;
  }
}

function getVisibleCount(view: ViewMode): number {
  switch (view) {
    case 'advisor':
      return ADVISOR_VISIBLE_ITEMS;
    case 'focus':
      return 12;
    case 'compare':
      return 6;
    case 'wrapped':
      return 20;
    case 'replay':
      return REPLAY_VISIBLE_BLOCKS;
    case 'nutrition':
      return NUTRITION_VISIBLE_ROWS;
    case 'receipts':
      return RECEIPTS_VISIBLE_ROWS;
    case 'simulator':
    case 'waste':
      return view === 'simulator' ? SIMULATOR_VISIBLE_ROWS : WASTE_VISIBLE_ROWS;
    case 'behavior':
      return 8;
    default:
      return 10;
  }
}

function getScrollOffset(state: AppState): number {
  switch (state.selectedView) {
    case 'advisor':
      return state.advisorScrollOffset;
    case 'focus':
      return state.focusScrollOffset;
    case 'compare':
      return state.compareScrollOffset;
    case 'wrapped':
      return state.wrappedScrollOffset;
    case 'replay':
      return state.replayScrollOffset;
    case 'nutrition':
      return state.nutritionScrollOffset;
    case 'receipts':
      return state.receiptsScrollOffset;
    case 'simulator':
      return state.simulatorScrollOffset;
    case 'waste':
      return state.wasteScrollOffset;
    case 'behavior':
      return state.behaviorScrollOffset;
    default:
      return 0;
  }
}

function setScrollOffset(state: AppState, value: number): void {
  switch (state.selectedView) {
    case 'advisor':
      state.advisorScrollOffset = value;
      break;
    case 'focus':
      state.focusScrollOffset = value;
      break;
    case 'compare':
      state.compareScrollOffset = value;
      break;
    case 'wrapped':
      state.wrappedScrollOffset = value;
      break;
    case 'replay':
      state.replayScrollOffset = value;
      break;
    case 'nutrition':
      state.nutritionScrollOffset = value;
      break;
    case 'receipts':
      state.receiptsScrollOffset = value;
      break;
    case 'simulator':
      state.simulatorScrollOffset = value;
      break;
    case 'waste':
      state.wasteScrollOffset = value;
      break;
    case 'behavior':
      state.behaviorScrollOffset = value;
      break;
  }
}

/** Handle export actions (p/w/l/a keys in export view) */
async function handleExport(
  key: 'p' | 'w' | 'l' | 'a',
  state: AppState,
  renderer: CliRenderer,
): Promise<void> {
  const output = buildTokenleakOutput(state, { computeMore: true });
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
    } else if (key === 'a') {
      state.exportStatus = 'Copying LLM prompt...';
      render(state, renderer);

      const scopedOutput = buildWindowScopedTokenleakOutput(state);
      if (!scopedOutput) {
        throw new Error('No data loaded');
      }
      const prompt = buildCommonsPromptExport(buildCommonsExport(scopedOutput));
      await copyTextToClipboard(prompt);
      state.exportStatus = 'Copied LLM analysis prompt to clipboard';
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    state.exportStatus =
      key === 'a'
        ? `Error: ${message}. CLI fallback: tokenleak commons prompt --output tokenleak-llm-prompt.md`
        : `Error: ${message}`;
  }

  render(state, renderer);
}

async function loadFreshDataInBackground(state: AppState, renderer: CliRenderer): Promise<void> {
  state.isLoading = state.data === null;
  render(state, renderer);

  try {
    const freshData = await loadAllData({ attemptCursorSync: false });
    applyLoadedData(state, freshData);
    writeCachedTuiData(freshData);
  } catch (err: unknown) {
    state.isLoading = false;
    state.loadError = `Refresh failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  render(state, renderer);
}

async function syncCursorInBackground(
  state: AppState,
  renderer: CliRenderer,
  options: { reloadData?: boolean } = {},
): Promise<void> {
  try {
    const status = await resolveCursorSetupStatus({ attemptSync: true });
    if (state.data) {
      state.data.cursorSetupStatus = status;
    }
    state.cursorSetupStatusOverride = status;
    render(state, renderer);

    if (options.reloadData !== false && status.state === 'ready') {
      const freshData = await loadAllData({ attemptCursorSync: false });
      applyLoadedData(state, freshData);
      writeCachedTuiData(freshData);
      render(state, renderer);
    }
  } catch {
    // Cursor sync is opportunistic during boot; explicit refresh surfaces errors.
  }
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
  const stopQuotaPolling = startQuotaPolling(state, () => {
    if (!renderer.isDestroyed) render(state, renderer);
  });
  renderer.on('destroy', stopQuotaPolling);

  // Show loading state immediately
  render(state, renderer);

  const cachedData = readCachedTuiData();
  if (cachedData) {
    applyLoadedData(state, cachedData);
    render(state, renderer);
  }

  void (async () => {
    if (cachedData) {
      await syncCursorInBackground(state, renderer, { reloadData: false });
      await loadFreshDataInBackground(state, renderer);
      return;
    }

    await loadFreshDataInBackground(state, renderer);
    await syncCursorInBackground(state, renderer);
  })();

  renderer.addInputHandler((sequence: string) => {
    if (handleCursorSetupInput(sequence, state, renderer)) {
      return true;
    }

    // Global [o] interactive replay launcher — must run before any
    // view-specific handlers so the footer CTA works on every view.
    if (handleGlobalReplayBrowserKey(sequence, state, renderer)) {
      return true;
    }

    if (handleReplayPlaybackInput(sequence, state, renderer)) {
      return true;
    }

    // Help toggle: ? key
    if (sequence === '?') {
      state.showHelp = !state.showHelp;
      render(state, renderer);
      return true;
    }

    // Escape closes help
    if (isEscapeKeySequence(sequence) && state.showHelp) {
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
      if (sequence === 'c') {
        return tryOpenCursorSetup(state, renderer);
      }
      return false;
    }

    if (sequence === 'c') {
      return tryOpenCursorSetup(state, renderer);
    }

    if (state.selectedView === 'quotas') {
      if (sequence === 'r') {
        void refreshQuotas(state, undefined, true).then(() => {
          if (!renderer.isDestroyed) render(state, renderer);
        });
        render(state, renderer);
        return true;
      }
      if (['j', 'k', '\x1b[B', '\x1b[A'].includes(sequence)) {
        const direction = sequence === 'j' || sequence === '\x1b[B' ? 1 : -1;
        state.quotasScrollOffset = Math.max(0, state.quotasScrollOffset + direction);
        render(state, renderer);
        return true;
      }
      if (['\t', '>', '<', '\x1b[Z'].includes(sequence)) return true;
    }

    // Tab or >: next time window
    if (sequence === '\t' || sequence === '>') {
      state.selectedWindowIndex = (state.selectedWindowIndex + 1) % WINDOW_LABELS.length;
      state.modelScrollOffset = 0;
      invalidateWindowCaches(state);
      render(state, renderer);
      return true;
    }

    // Shift+Tab or <: prev time window
    if (sequence === '\x1b[Z' || sequence === '<') {
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

    // 1-9/0: switch view
    const viewMode = VIEW_KEYS[sequence];
    if (viewMode) {
      handleViewSwitch(viewMode);
      return true;
    }

    // Export view actions: p/w/l/a
    if (
      state.selectedView === 'export' &&
      (sequence === 'p' || sequence === 'w' || sequence === 'l' || sequence === 'a')
    ) {
      handleExport(sequence, state, renderer);
      return true;
    }

    // j / Down: scroll down (overview model list or scrollable views)
    if (sequence === 'j' || sequence === '\x1b[B') {
      if (state.selectedView === 'overview') {
        const windowStats = state.data?.windows[state.selectedWindowIndex]?.stats;
        const modelCount = (windowStats?.allModels ?? windowStats?.topModels)?.length ?? 0;
        const visibleCount = 10;
        const maxOffset = Math.max(0, modelCount - visibleCount);
        if (state.modelScrollOffset < maxOffset) {
          state.modelScrollOffset++;
          render(state, renderer);
        }
        return true;
      }
      if (state.selectedView === 'replay') {
        moveReplaySelection(state, 1);
        render(state, renderer);
        return true;
      }
      if (state.selectedView === 'receipts') {
        moveReceiptSelection(state, 1);
        render(state, renderer);
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
      if (state.selectedView === 'replay') {
        moveReplaySelection(state, -1);
        render(state, renderer);
        return true;
      }
      if (state.selectedView === 'receipts') {
        moveReceiptSelection(state, -1);
        render(state, renderer);
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

    // h: prev day (explain/replay view)
    if (sequence === 'h' && state.selectedView === 'explain') {
      shiftExplainDate(state, -1);
      render(state, renderer);
      return true;
    }
    if (sequence === 'h' && state.selectedView === 'replay') {
      shiftReplayDate(state, -1);
      render(state, renderer);
      return true;
    }

    // l: next day (explain/replay view)
    if (sequence === 'l' && state.selectedView === 'explain') {
      shiftExplainDate(state, 1);
      render(state, renderer);
      return true;
    }
    if (sequence === 'l' && state.selectedView === 'replay') {
      shiftReplayDate(state, 1);
      render(state, renderer);
      return true;
    }

    // Enter/Space: expand/collapse the selected flow block (replay view)
    if ((sequence === '\r' || sequence === ' ') && state.selectedView === 'replay') {
      toggleReplayBlock(state);
      render(state, renderer);
      return true;
    }

    // Enter/Space: expand/collapse sample prompts for the selected receipt line
    if ((sequence === '\r' || sequence === ' ') && state.selectedView === 'receipts') {
      toggleReceiptLine(state);
      render(state, renderer);
      return true;
    }

    // S: cycle sort mode (receipts view). Moved off [o] because the
    // global interactive-replay launcher now owns that key.
    if (sequence === 'S' && state.selectedView === 'receipts') {
      const order: Array<'cost' | 'qty' | 'alpha'> = ['cost', 'qty', 'alpha'];
      const nextIndex = (order.indexOf(state.receiptsSortMode) + 1) % order.length;
      state.receiptsSortMode = order[nextIndex]!;
      resetReceiptsInteraction(state);
      render(state, renderer);
      return true;
    }

    // f: cycle category filter through encountered categories + null (receipts view)
    if (sequence === 'f' && state.selectedView === 'receipts') {
      const receipt = state.cachedReceipt;
      if (!receipt || receipt.lines.length === 0) {
        return true;
      }
      const categories = Array.from(new Set(receipt.lines.map((l) => l.category)));
      const current = state.receiptsCategoryFilter;
      const currentIndex = current === null ? -1 : categories.indexOf(current);
      const nextIndex = currentIndex + 1;
      state.receiptsCategoryFilter = nextIndex >= categories.length ? null : categories[nextIndex]!;
      resetReceiptsInteraction(state);
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
      void reloadAllData(state, renderer);
      return true;
    }

    // q: quit
    if (sequence === 'q') {
      stopReplayLiveServer(state);
      renderer.destroy();
      process.exit(0);
    }

    return false;
  });
}
