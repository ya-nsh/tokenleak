import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { CliRenderer } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { getTodayLocal } from '@tokenleak/core';
import { buildLayout } from './index';
import {
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
} from './lib/data';
import { reconcileChildren } from './lib/reconcile';
import { createInitialState } from './lib/state';
import type { AppState, ViewMode } from './lib/state';
import { makeTuiData } from './lib/__fixtures__/usage';

const WIDTH = 140;
const HEIGHT = 44;
type Harness = Awaited<ReturnType<typeof createTestRenderer>>;
let patched: Harness;
let fresh: Harness;

beforeAll(async () => {
  patched = await createTestRenderer({ width: WIDTH, height: HEIGHT });
  fresh = await createTestRenderer({ width: WIDTH, height: HEIGHT });
});

afterAll(() => {
  patched.renderer.destroy();
  fresh.renderer.destroy();
});

/** A state whose reports are already built, so no view schedules work. */
function stateFor(view: ViewMode, window: number, extra: (state: AppState) => void = () => {}): AppState {
  const state = createInitialState();
  state.data = makeTuiData(getTodayLocal());
  state.isLoading = false;
  state.selectedWindowIndex = window;
  state.selectedView = view;
  state.explainDate = getTodayLocal();
  state.replayDate = getTodayLocal();
  ensureSavingsReport(state);
  ensureRoutingSimulationReport(state);
  ensureAgentBehaviorDiffReport(state);
  ensureFocusReport(state);
  ensureExplainReport(state);
  ensureCompareOutput(state);
  ensureMoreStats(state);
  ensureReceipt(state);
  ensureReplayReport(state);
  ensureNutritionReport(state);
  extra(state);
  return state;
}

async function patchedFrame(state: AppState) {
  reconcileChildren(patched.renderer as CliRenderer, patched.renderer.root, [buildLayout(state, patched.renderer as CliRenderer)]);
  await patched.renderOnce();
  return { chars: patched.captureCharFrame(), spans: JSON.stringify(patched.captureSpans()) };
}

async function freshFrame(state: AppState) {
  for (const child of fresh.renderer.root.getChildren()) child.destroyRecursively();
  fresh.renderer.root.add(buildLayout(state, fresh.renderer as CliRenderer));
  await fresh.renderOnce();
  return { chars: fresh.captureCharFrame(), spans: JSON.stringify(fresh.captureSpans()) };
}

const VIEWS: ViewMode[] = [
  'overview', 'quotas', 'matrix', 'compare', 'focus', 'replay', 'explain',
  'advisor', 'waste', 'simulator', 'receipts', 'nutrition', 'behavior', 'export', 'wrapped',
];

describe('patched frames', () => {
  test('match a fresh build for every view, window and matrix page, in any order', async () => {
    const states: AppState[] = [];
    for (const window of [1, 4]) {
      for (const view of VIEWS) states.push(stateFor(view, window));
      for (const page of [1, 2, 3]) states.push(stateFor('matrix', window, (s) => (s.matrixPage = page)));
    }
    states.push(stateFor('overview', 4, (s) => (s.showHelp = true)));
    states.push(stateFor('overview', 4, (s) => (s.sortMode = 'tokens')));
    states.push(stateFor('receipts', 4, (s) => (s.receiptsExpandedLineIndex = 0)));
    states.push(stateFor('overview', 1, (s) => (s.palette = { query: '', selected: 3 })));
    states.push(stateFor('overview', 1, (s) => (s.palette = { query: 'rcpt', selected: 0 })));
    states.push(stateFor('overview', 1, (s) => (s.palette = { query: 'zzzz', selected: 0 })));
    states.push(stateFor('overview', 1, (s) => (s.filter = { provider: 'codex', model: 'claude-haiku-5-5' })));

    for (const order of [states, [...states].reverse()]) {
      for (const state of order) {
        const [a, b] = [await patchedFrame(state), await freshFrame(state)];
        expect(`${state.selectedView}@${state.selectedWindowIndex}\n${a.chars}`).toBe(
          `${state.selectedView}@${state.selectedWindowIndex}\n${b.chars}`,
        );
        expect(a.spans).toBe(b.spans);
      }
    }
  });
});
