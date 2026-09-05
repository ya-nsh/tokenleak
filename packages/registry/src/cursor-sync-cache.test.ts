import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCursorCacheDir, saveCursorCredentials, shouldSyncCursorForRun } from './cursor-auth';

const originalDir = process.env['TOKENLEAK_CURSOR_DIR'];
const originalInterval = process.env['TOKENLEAK_CURSOR_SYNC_INTERVAL_MS'];
const originalFetch = globalThis.fetch;
const config = { cursor: false, claude: false, codex: false, pi: false, openCode: false, allProviders: false };
let root: string;
let requests: number;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tokenleak-sync-cache-'));
  process.env['TOKENLEAK_CURSOR_DIR'] = root;
  delete process.env['TOKENLEAK_CURSOR_SYNC_INTERVAL_MS'];
  saveCursorCredentials('test-user::test-token');
  mkdirSync(getCursorCacheDir(), { recursive: true });
  writeFileSync(join(getCursorCacheDir(), 'usage.csv'), 'Date,Model,Cost\n');
  requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new Response('forbidden', { status: 403 });
  }) as typeof fetch;
});
afterEach(() => {
  if (originalDir === undefined) delete process.env['TOKENLEAK_CURSOR_DIR'];
  else process.env['TOKENLEAK_CURSOR_DIR'] = originalDir;
  if (originalInterval === undefined) delete process.env['TOKENLEAK_CURSOR_SYNC_INTERVAL_MS'];
  else process.env['TOKENLEAK_CURSOR_SYNC_INTERVAL_MS'] = originalInterval;
  globalThis.fetch = originalFetch;
  rmSync(root, { recursive: true, force: true });
});
test('backs off failed automatic requests with cached usage, preserving the warning', async () => {
  const first = await shouldSyncCursorForRun(config);
  const count = requests;
  expect(first.attempted).toBe(true);
  expect(first.error).toBeDefined();
  expect(await shouldSyncCursorForRun(config)).toEqual({ attempted: false, error: first.error });
  expect(requests).toBe(count);
});
test('explicit selection, credential changes and cache removal retry immediately', async () => {
  await shouldSyncCursorForRun(config);
  expect((await shouldSyncCursorForRun({ ...config, cursor: true })).attempted).toBe(true);
  saveCursorCredentials('test-user::replacement-token');
  expect((await shouldSyncCursorForRun(config)).attempted).toBe(true);
  rmSync(join(getCursorCacheDir(), 'usage.csv'));
  expect((await shouldSyncCursorForRun(config)).attempted).toBe(true);
});
test('expired sync results and the zero-interval escape hatch retry immediately', async () => {
  await shouldSyncCursorForRun(config);
  const path = join(getCursorCacheDir(), 'automatic-sync.json');
  const memo = await Bun.file(path).json();
  writeFileSync(path, JSON.stringify({ ...memo, completedAt: Date.now() - 61_000 }));
  expect((await shouldSyncCursorForRun(config)).attempted).toBe(true);
  process.env['TOKENLEAK_CURSOR_SYNC_INTERVAL_MS'] = '0';
  expect((await shouldSyncCursorForRun(config)).attempted).toBe(true);
});
test('reuses a successful automatic sync without fetching again', async () => {
  globalThis.fetch = (async (url) => {
    requests++;
    if (String(url).includes('usage-summary')) return new Response('{}');
    return new Response('Date,Model,Cost\n2026-03-10,gpt-4o,0.01\n');
  }) as typeof fetch;
  expect(await shouldSyncCursorForRun(config)).toEqual({ attempted: true, error: undefined });
  const count = requests;
  expect(await shouldSyncCursorForRun(config)).toEqual({ attempted: false, error: undefined });
  expect(requests).toBe(count);
});
