import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getTodayLocal } from '@tokenleak/core';
import { EngineCore } from './engine-core';
import { createDataEngine, ENGINE_WORKER_FILES, resolveEngineWorkerUrl } from './engine';
import type { DataEngine } from './engine';
import { handleEngineRequest, isEngineRequest, isEngineResponse } from './engine-protocol';
import { writeCachedTuiData } from './data';
import { makeTuiData } from './__fixtures__/usage';

const ALL_WINDOW = 4;
const originalCachePath = process.env['TOKENLEAK_TUI_CACHE_PATH'];
let dir: string;
let engines: DataEngine[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tokenleak-engine-client-'));
  // Workers inherit the environment at start, so set the snapshot path first.
  process.env['TOKENLEAK_TUI_CACHE_PATH'] = join(dir, 'tui-data.json');
  writeCachedTuiData(makeTuiData(getTodayLocal()));
});

afterEach(() => {
  for (const engine of engines) engine.dispose();
  engines = [];
  if (originalCachePath === undefined) delete process.env['TOKENLEAK_TUI_CACHE_PATH'];
  else process.env['TOKENLEAK_TUI_CACHE_PATH'] = originalCachePath;
  rmSync(dir, { recursive: true, force: true });
});

function track(engine: DataEngine): DataEngine {
  engines.push(engine);
  return engine;
}

describe('createDataEngine', () => {
  test('runs the engine in a worker and returns the same results as in-process', async () => {
    const worker = track(createDataEngine());
    const local = track(createDataEngine({ preferWorker: false }));
    expect(worker.isolated).toBe(true);
    expect(local.isolated).toBe(false);

    const [workerData, localData] = await Promise.all([worker.call('loadCached'), local.call('loadCached')]);
    expect(workerData).toEqual(localData);
    expect(workerData?.providers.every((provider) => provider.events === undefined)).toBe(true);

    const request = { kind: 'savings' as const, window: ALL_WINDOW };
    expect(await worker.report(request)).toEqual(await local.report(request));
  });

  test('answers concurrent requests by id', async () => {
    const engine = track(createDataEngine());
    await engine.call('loadCached');
    const [focus, more, compare] = await Promise.all([
      engine.report({ kind: 'focus', window: ALL_WINDOW }),
      engine.report({ kind: 'more', window: ALL_WINDOW }),
      engine.report({ kind: 'compare', window: ALL_WINDOW }),
    ]);
    expect(focus?.entries.length).toBeGreaterThan(0);
    expect(more).not.toBeNull();
    expect(compare?.deltas).toBeDefined();
  });

  test('surfaces engine errors as rejections', async () => {
    const engine = track(createDataEngine());
    await expect(engine.call('llmPrompt', 99)).rejects.toThrow('No data loaded');
  });

  test('falls back to in-process when the worker cannot start', async () => {
    const broken = join(dir, 'broken-worker.ts');
    writeFileSync(broken, "throw new Error('cannot load');\n");
    const engine = track(createDataEngine({ workerUrl: pathToFileURL(broken) }));
    const data = await engine.call('loadCached');
    expect(data?.providers.length).toBe(2);
    expect(engine.isolated).toBe(false);
  });

  test('rejects calls after dispose', async () => {
    const engine = createDataEngine();
    expect(engine.isolated).toBe(true);
    engine.dispose();
    await expect(engine.call('loadCached')).rejects.toThrow('shut down');
  });
});

describe('resolveEngineWorkerUrl', () => {
  test('finds the worker next to this module in src or a compiled dist', () => {
    expect(resolveEngineWorkerUrl()?.pathname).toMatch(/\/engine-worker\.(ts|js)$/);
  });

  test('finds the bundled worker beside the npm executable', () => {
    writeFileSync(join(dir, 'tokenleak-engine.js'), '');
    const url = resolveEngineWorkerUrl(pathToFileURL(join(dir, 'tokenleak')).href);
    expect(url?.pathname.endsWith('/tokenleak-engine.js')).toBe(true);
    expect(ENGINE_WORKER_FILES).toContain('./tokenleak-engine.js');
  });

  test('returns null when no worker entry exists', () => {
    expect(resolveEngineWorkerUrl(pathToFileURL(join(dir, 'empty', 'x.js')).href)).toBeNull();
  });
});

describe('engine protocol', () => {
  test('validates request and response shapes', () => {
    expect(isEngineRequest({ id: 1, method: 'report', args: [] })).toBe(true);
    expect(isEngineRequest({ id: 1, method: 'constructor', args: [] })).toBe(false);
    expect(isEngineRequest({ id: '1', method: 'report', args: [] })).toBe(false);
    expect(isEngineRequest(null)).toBe(false);
    expect(isEngineResponse({ id: 1, ok: true, value: null })).toBe(true);
    expect(isEngineResponse({ id: 1, ok: false })).toBe(false);
  });

  test('packages thrown errors as failed responses', async () => {
    const response = await handleEngineRequest(new EngineCore(), { id: 7, method: 'llmPrompt', args: [0] });
    expect(response).toEqual({ id: 7, ok: false, error: 'No data loaded' });
  });
});
