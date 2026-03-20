import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getCursorCacheDir,
  resolveCursorSetupStatus,
  saveCursorCredentials,
} from './cursor-auth';

const SAMPLE_CSV = [
  'Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost',
  '2026-03-10T12:34:56Z,chat,claude-sonnet-4-20250514,false,1200,1000,200,300,1700,$0.0100',
  '',
].join('\n');

describe('resolveCursorSetupStatus', () => {
  const originalCursorDir = process.env['TOKENLEAK_CURSOR_DIR'];
  const originalFetch = globalThis.fetch;
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'tokenleak-cursor-status-'));
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

  test('returns needs_auth when no credentials or cache exist', async () => {
    await expect(resolveCursorSetupStatus({ attemptSync: true })).resolves.toMatchObject({
      state: 'needs_auth',
      hasCredentials: false,
      hasCache: false,
    });
  });

  test('returns ready after a successful initial sync', async () => {
    saveCursorCredentials('user-work::token-work', 'work');
    globalThis.fetch = (async (url) => {
      if (String(url).includes('/api/usage-summary')) {
        return new Response(JSON.stringify({
          billingCycleStart: '2026-03-01',
          billingCycleEnd: '2026-03-31',
          membershipType: 'pro',
        }), { status: 200 });
      }
      return new Response(SAMPLE_CSV, { status: 200 });
    }) as typeof fetch;

    const result = await resolveCursorSetupStatus({ attemptSync: true });

    expect(result.state).toBe('ready');
    expect(result.hasCredentials).toBe(true);
    expect(result.hasCache).toBe(true);
  });

  test('returns needs_reauth when sync fails without cache because of auth', async () => {
    saveCursorCredentials('user-work::token-work', 'work');
    globalThis.fetch = (async () => new Response('forbidden', { status: 403 })) as typeof fetch;

    await expect(resolveCursorSetupStatus({ attemptSync: true })).resolves.toMatchObject({
      state: 'needs_reauth',
      hasCredentials: true,
      hasCache: false,
      reason: 'auth',
    });
  });

  test('returns sync_failed_cached when sync fails but cached CSV is present', async () => {
    saveCursorCredentials('user-work::token-work', 'work');
    mkdirSync(getCursorCacheDir(), { recursive: true });
    writeFileSync(join(getCursorCacheDir(), 'usage.csv'), SAMPLE_CSV);
    globalThis.fetch = (async () => new Response('bad gateway', { status: 502 })) as typeof fetch;

    await expect(resolveCursorSetupStatus({ attemptSync: true })).resolves.toMatchObject({
      state: 'sync_failed_cached',
      hasCredentials: true,
      hasCache: true,
      reason: 'api',
    });
  });
});
