import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getCursorCacheDir,
  getCursorCredentialsPath,
  listCursorAccounts,
  loadCursorCredentialsStore,
  removeAllCursorAccounts,
  saveCursorCredentials,
  setActiveCursorAccount,
  shouldSyncCursorForRun,
  syncCursorCache,
  validateCursorSession,
} from './cursor.js';

const SAMPLE_CSV = [
  'Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost',
  '2026-03-10T12:34:56Z,chat,claude-sonnet-4-20250514,false,1200,1000,200,300,1700,$0.0100',
  '2026-03-11T06:00:00Z,chat,gpt-4o-2025-01-29,false,550,500,50,100,700,$0.0024',
  '',
].join('\n');

describe('cursor auth and sync helpers', () => {
  const originalCursorDir = process.env['TOKENLEAK_CURSOR_DIR'];
  const originalFetch = globalThis.fetch;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'tokenleak-cursor-'));
    process.env['TOKENLEAK_CURSOR_DIR'] = tempRoot;
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    if (originalCursorDir === undefined) {
      delete process.env['TOKENLEAK_CURSOR_DIR'];
    } else {
      process.env['TOKENLEAK_CURSOR_DIR'] = originalCursorDir;
    }
    globalThis.fetch = originalFetch;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test('stores accounts, tracks the active account, and swaps cache files on switch', () => {
    const workId = saveCursorCredentials('user-work::token-work', 'work');
    const personalId = saveCursorCredentials('user-personal::token-personal', 'personal');

    const cacheDir = getCursorCacheDir();
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'usage.csv'), 'active-personal\n');
    writeFileSync(join(cacheDir, `usage.${workId}.csv`), 'work-cache\n');

    expect(listCursorAccounts().map((account) => account.id)).toEqual([personalId, workId]);

    setActiveCursorAccount('work');

    expect(loadCursorCredentialsStore()?.activeAccountId).toBe(workId);
    expect(readFileSync(join(cacheDir, 'usage.csv'), 'utf8')).toBe('work-cache\n');
    expect(readFileSync(join(cacheDir, `usage.${personalId}.csv`), 'utf8')).toBe('active-personal\n');
  });

  test('validates a Cursor session from the usage summary endpoint', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      billingCycleStart: '2026-03-01',
      billingCycleEnd: '2026-03-31',
      membershipType: 'pro',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    await expect(validateCursorSession('token-123')).resolves.toEqual({
      valid: true,
      membershipType: 'pro',
    });
  });

  test('syncs cached CSV files for the active and additional Cursor accounts', async () => {
    const workId = saveCursorCredentials('user-work::token-work', 'work');
    const personalId = saveCursorCredentials('user-personal::token-personal', 'personal');

    const calls: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      calls.push(String(init?.headers && (init.headers as Record<string, string>)['Cookie']));
      return new Response(SAMPLE_CSV, { status: 200 });
    }) as typeof fetch;

    const result = await syncCursorCache();

    expect(result.synced).toBe(true);
    expect(result.rows).toBe(4);
    expect(calls).toHaveLength(2);
    expect(readFileSync(join(getCursorCacheDir(), 'usage.csv'), 'utf8')).toContain('Date,Kind,Model');
    expect(readFileSync(join(getCursorCacheDir(), `usage.${workId}.csv`), 'utf8')).toContain('claude-sonnet-4-20250514');
    expect(existsSync(join(getCursorCacheDir(), `usage.${personalId}.csv`))).toBe(false);
  });

  test('skips sync when Cursor is not part of the requested provider set', async () => {
    saveCursorCredentials('user-work::token-work', 'work');
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response(SAMPLE_CSV, { status: 200 });
    }) as typeof fetch;

    const result = await shouldSyncCursorForRun({
      provider: 'claude-code',
      claude: true,
      codex: false,
      cursor: false,
      pi: false,
      openCode: false,
      allProviders: false,
    });

    expect(result.attempted).toBe(false);
    expect(called).toBe(false);
  });

  test('syncs when Cursor is explicitly requested and keeps cache on cleanup', async () => {
    saveCursorCredentials('user-work::token-work', 'work');
    globalThis.fetch = (async () => new Response(SAMPLE_CSV, { status: 200 })) as typeof fetch;

    const result = await shouldSyncCursorForRun({
      provider: 'cursor',
      claude: false,
      codex: false,
      cursor: false,
      pi: false,
      openCode: false,
      allProviders: false,
    });

    expect(result.attempted).toBe(true);
    expect(result.error).toBeUndefined();
    expect(existsSync(join(getCursorCacheDir(), 'usage.csv'))).toBe(true);

    removeAllCursorAccounts(true);
    expect(existsSync(getCursorCredentialsPath())).toBe(false);
  });
});
