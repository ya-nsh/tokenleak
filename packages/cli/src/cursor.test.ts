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
  resetCursorProviderState,
  runCursorCommand,
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
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'tokenleak-cursor-'));
    process.env['TOKENLEAK_CURSOR_DIR'] = tempRoot;
    for (const key of [
      'TOKENLEAK_CURSOR_PROXY',
      'TOKENLEAK_CURSOR_CA_FILE',
      'TOKENLEAK_CURSOR_TIMEOUT_MS',
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
      'NO_PROXY',
      'no_proxy',
    ]) {
      delete process.env[key];
    }
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    for (const key of [
      'TOKENLEAK_CURSOR_DIR',
      'TOKENLEAK_CURSOR_PROXY',
      'TOKENLEAK_CURSOR_CA_FILE',
      'TOKENLEAK_CURSOR_TIMEOUT_MS',
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
      'NO_PROXY',
      'no_proxy',
    ]) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
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

  test('does not delete the active-account duplicate cache when sync fails', async () => {
    const activeId = saveCursorCredentials('user-work::token-work', 'work');
    const duplicatePath = join(getCursorCacheDir(), `usage.${activeId}.csv`);

    mkdirSync(getCursorCacheDir(), { recursive: true });
    writeFileSync(duplicatePath, 'old-active-cache\n');
    globalThis.fetch = (async () => new Response('forbidden', { status: 403 })) as typeof fetch;

    const result = await syncCursorCache();

    expect(result.synced).toBe(false);
    expect(existsSync(duplicatePath)).toBe(true);
    expect(readFileSync(duplicatePath, 'utf8')).toBe('old-active-cache\n');
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

  test('reset helper clears all saved accounts and local cache', () => {
    saveCursorCredentials('user-work::token-work', 'work');
    mkdirSync(getCursorCacheDir(), { recursive: true });
    writeFileSync(join(getCursorCacheDir(), 'usage.csv'), SAMPLE_CSV);

    resetCursorProviderState();

    expect(existsSync(getCursorCredentialsPath())).toBe(false);
    expect(existsSync(join(getCursorCacheDir(), 'usage.csv'))).toBe(false);
    expect(listCursorAccounts()).toEqual([]);
  });

  test('cursor help includes doctor diagnostics', async () => {
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await runCursorCommand(['--help']);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(output).toContain('tokenleak cursor doctor [--name <label>] [--with-token] [--insecure-skip-tls-verify]');
  });

  test('cursor doctor redacts proxy credentials and saved token details', async () => {
    process.env['TOKENLEAK_CURSOR_PROXY'] = 'http://user:secret@proxy.company:8080';
    saveCursorCredentials('user-work::super-secret-token', 'work');
    globalThis.fetch = (async (url, init) => {
      const cookie = String((init?.headers as Record<string, string> | undefined)?.['Cookie'] ?? '');
      const hasToken = cookie.includes('super-secret-token');
      if (String(url).includes('/api/usage-summary')) {
        if (!hasToken) {
          return new Response(JSON.stringify({ error: 'not_authenticated' }), { status: 401 });
        }
        return new Response(JSON.stringify({
          billingCycleStart: '2026-03-01',
          billingCycleEnd: '2026-03-31',
          membershipType: 'pro',
        }), { status: 200 });
      }
      if (!hasToken) {
        return new Response('', { status: 307, headers: { location: 'https://api.workos.com' } });
      }
      return new Response(SAMPLE_CSV, { status: 200 });
    }) as typeof fetch;

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await runCursorCommand(['doctor', '--name', 'work', '--with-token']);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(output).toContain('Cursor network doctor');
    expect(output).toContain('Proxy: http://***:***@proxy.company:8080');
    expect(output).toContain('Token check: enabled');
    expect(output).not.toContain('super-secret-token');
    expect(output).not.toContain('user:secret');
    expect(output).not.toContain('Set-Cookie');
  });

  test('cursor login network errors point to doctor and Cursor network env vars', async () => {
    globalThis.fetch = (async () => {
      throw new Error('self signed certificate in certificate chain');
    }) as typeof fetch;

    await expect(validateCursorSession('token-123')).resolves.toMatchObject({
      valid: false,
      reason: 'network',
      error: expect.stringContaining('TOKENLEAK_CURSOR_CA_FILE'),
    });
  });

  test('cursor doctor reports a missing CA file without crashing', async () => {
    const missingCaPath = join(tempRoot, 'missing-company-root-ca.pem');
    process.env['TOKENLEAK_CURSOR_CA_FILE'] = missingCaPath;
    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      await runCursorCommand(['doctor']);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(output).toContain('Cursor network doctor');
    expect(output).toContain('CA file:');
    expect(output).toContain(missingCaPath);
    expect(output).toContain('[fail] ca-file');
    expect(output).toContain('TOKENLEAK_CURSOR_CA_FILE');
  });
});
