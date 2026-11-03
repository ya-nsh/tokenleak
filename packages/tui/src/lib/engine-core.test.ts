import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTodayLocal } from '@tokenleak/core';
import { EngineCore, slimTuiData } from './engine-core';
import type { ReportKind } from './engine-core';
import {
  ensureAgentBehaviorDiffReport,
  ensureFocusReport,
  ensureMoreStats,
  ensureReceipt,
  ensureSavingsReport,
  writeCachedTuiData,
} from './data';
import { createInitialState } from './state';
import { makeTuiData } from './__fixtures__/usage';

const ALL_WINDOW = 4;
const SEVEN_DAY_WINDOW = 1;
const THIRTY_DAY_WINDOW = 2;
const originalCachePath = process.env['TOKENLEAK_TUI_CACHE_PATH'];
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tokenleak-engine-'));
  process.env['TOKENLEAK_TUI_CACHE_PATH'] = join(dir, 'tui-data.json');
});

afterEach(() => {
  if (originalCachePath === undefined) delete process.env['TOKENLEAK_TUI_CACHE_PATH'];
  else process.env['TOKENLEAK_TUI_CACHE_PATH'] = originalCachePath;
  rmSync(dir, { recursive: true, force: true });
});

async function loadedEngine(): Promise<EngineCore> {
  writeCachedTuiData(makeTuiData(getTodayLocal()));
  const engine = new EngineCore();
  await engine.loadCached();
  return engine;
}

describe('slimTuiData', () => {
  test('drops per-event history and keeps totals, daily rows and windows', () => {
    const data = makeTuiData('2026-11-03');
    const slim = slimTuiData(data);
    expect(slim.providers.every((provider) => provider.events === undefined)).toBe(true);
    expect(slim.providers.map((provider) => provider.totalCost)).toEqual(data.providers.map((p) => p.totalCost));
    expect(slim.providers[0]!.daily).toEqual(data.providers[0]!.daily);
    expect(slim.windows).toEqual(data.windows);
    expect(data.providers[0]!.events?.length).toBeGreaterThan(0);
  });
});

describe('EngineCore', () => {
  test('loadCached returns null without a snapshot and leaves reports unavailable', async () => {
    const engine = new EngineCore();
    expect(await engine.loadCached()).toBeNull();
    expect(await engine.report({ kind: 'savings', window: ALL_WINDOW })).toBeNull();
  });

  test('loadCached hands the interface slim data but keeps events for reports', async () => {
    writeCachedTuiData(makeTuiData(getTodayLocal()));
    const engine = new EngineCore();
    const slim = await engine.loadCached();
    expect(slim?.providers.every((provider) => provider.events === undefined)).toBe(true);
    const receipt = await engine.report({ kind: 'receipt', window: ALL_WINDOW });
    expect(receipt?.lines.length).toBeGreaterThan(0);
  });

  test('reports match the in-thread builders for the same window', async () => {
    const engine = await loadedEngine();
    const state = createInitialState();
    state.data = makeTuiData(getTodayLocal());
    state.selectedWindowIndex = SEVEN_DAY_WINDOW;

    expect(await engine.report({ kind: 'savings', window: SEVEN_DAY_WINDOW })).toEqual(ensureSavingsReport(state)!);
    expect(await engine.report({ kind: 'focus', window: SEVEN_DAY_WINDOW })).toEqual(ensureFocusReport(state)!);
    expect(await engine.report({ kind: 'more', window: SEVEN_DAY_WINDOW })).toEqual(ensureMoreStats(state)!);
    expect(await engine.report({ kind: 'behavior', window: SEVEN_DAY_WINDOW })).toEqual(
      ensureAgentBehaviorDiffReport(state)!,
    );
    const receipt = await engine.report({ kind: 'receipt', window: SEVEN_DAY_WINDOW });
    expect(receipt?.lines).toEqual(ensureReceipt(state)!.lines);
  });

  test('every report kind resolves for a window with data', async () => {
    const engine = await loadedEngine();
    const kinds: ReportKind[] = ['savings', 'routing', 'behavior', 'focus', 'compare', 'more', 'receipt', 'explain', 'replay'];
    for (const kind of kinds) {
      expect(await engine.report({ kind, window: ALL_WINDOW, date: getTodayLocal() })).not.toBeNull();
    }
  });

  test('date-scoped reports follow the requested day', async () => {
    const engine = await loadedEngine();
    const today = getTodayLocal();
    const replayToday = await engine.report({ kind: 'replay', window: ALL_WINDOW, date: today });
    expect(replayToday?.date).toBe(today);
    expect(replayToday?.events.length).toBe(8);
    const explain = await engine.report({ kind: 'explain', window: ALL_WINDOW, date: today });
    expect(explain?.date).toBe(today);
  });

  test('a window without data yields null rather than throwing', async () => {
    const engine = await loadedEngine();
    expect(await engine.report({ kind: 'focus', window: 99 })).toBeNull();
  });

  test('builds the LLM prompt and PNG exports from full event data', async () => {
    const engine = await loadedEngine();
    const prompt = await engine.llmPrompt(ALL_WINDOW);
    expect(prompt).toContain('"provider": "claude-code"');
    // Event-count buckets are only filled when the export sees raw events.
    expect(prompt).toContain('"eventCountBucket": "10-19"');
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const path = await engine.exportImage(THIRTY_DAY_WINDOW, 'png');
      expect(readFileSync(join(dir, path)).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    } finally {
      process.chdir(cwd);
    }
  });

  test('exports fail clearly before any data is loaded', async () => {
    const engine = new EngineCore();
    await expect(engine.llmPrompt(ALL_WINDOW)).rejects.toThrow('No data loaded');
    await expect(engine.exportImage(ALL_WINDOW, 'png')).rejects.toThrow('No data loaded');
    await expect(engine.openLiveSite({ wrapped: { window: ALL_WINDOW } })).rejects.toThrow('No data loaded');
  });

  test('serves replay on the live site and stops it', async () => {
    const engine = await loadedEngine();
    const site = await engine.openLiveSite({ replay: { window: ALL_WINDOW, date: null } });
    try {
      expect(site.replay?.date).toBe(getTodayLocal());
      expect(site.urls.replay).toContain(`:${site.port}`);
      const response = await fetch(site.urls.replay!);
      expect(response.status).toBe(200);
    } finally {
      await engine.stopLiveSite();
    }
    await engine.stopLiveSite();
  });

  test('a filter narrows reports and survives a reload; clearing restores everything', async () => {
    const engine = await loadedEngine();
    const unfiltered = await engine.report({ kind: 'more', window: ALL_WINDOW });
    const filtered = await engine.setFilter({ provider: 'codex' });
    expect(filtered?.providers.map((p) => p.provider)).toEqual(['codex']);
    expect(filtered?.filterOptions?.providers.map((p) => p.key).sort()).toEqual(['claude-code', 'codex']);
    const receipt = await engine.report({ kind: 'receipt', window: ALL_WINDOW });
    expect(receipt?.lines.length).toBeGreaterThan(0);
    const cached = await engine.loadCached();
    expect(cached?.providers.map((p) => p.provider)).toEqual(['codex']);
    const cleared = await engine.setFilter({});
    expect(cleared?.providers).toHaveLength(2);
    expect(await engine.report({ kind: 'more', window: ALL_WINDOW })).toEqual(unfiltered);
  });

  test('setFilter before any load returns null', async () => {
    expect(await new EngineCore().setFilter({ provider: 'codex' })).toBeNull();
  });
});
