import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyCursorNetworkError,
  diagnoseCursorConnection,
  getCursorCacheDir,
  removeAllCursorAccounts,
  resolveCursorSetupStatus,
  resolveCursorNetworkSettings,
  saveCursorCredentials,
  validateCursorSession,
} from './cursor-auth';

const SAMPLE_CSV = [
  'Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost',
  '2026-03-10T12:34:56Z,chat,claude-sonnet-4-20250514,false,1200,1000,200,300,1700,$0.0100',
  '',
].join('\n');

describe('resolveCursorSetupStatus', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'tokenleak-cursor-status-'));
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

  test('returns needs_reauth when the active account fails auth but another account syncs', async () => {
    saveCursorCredentials('user-work::token-work', 'work');
    saveCursorCredentials('user-personal::token-personal', 'personal');

    globalThis.fetch = (async (_url, init) => {
      const cookie = String((init?.headers as Record<string, string> | undefined)?.['Cookie'] ?? '');
      if (cookie.includes('user-personal::token-personal')) {
        return new Response('forbidden', { status: 403 });
      }
      return new Response(SAMPLE_CSV, { status: 200 });
    }) as typeof fetch;

    await expect(resolveCursorSetupStatus({ attemptSync: true })).resolves.toMatchObject({
      state: 'needs_reauth',
      hasCredentials: true,
      hasCache: true,
      reason: 'auth',
    });
  });

  test('treats aborted validation requests as network failures', async () => {
    globalThis.fetch = (async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }) as typeof fetch;

    await expect(validateCursorSession('user-work::token-work')).resolves.toMatchObject({
      valid: false,
      reason: 'network',
    });
  });

  test('purge removes archived cache files too', () => {
    saveCursorCredentials('user-work::token-work', 'work');
    mkdirSync(join(getCursorCacheDir(), 'archive'), { recursive: true });
    writeFileSync(join(getCursorCacheDir(), 'usage.csv'), SAMPLE_CSV);
    writeFileSync(join(getCursorCacheDir(), 'archive', 'old.csv'), SAMPLE_CSV);

    removeAllCursorAccounts(true);

    expect(existsSync(join(getCursorCacheDir(), 'usage.csv'))).toBe(false);
    expect(existsSync(join(getCursorCacheDir(), 'archive'))).toBe(false);
  });

  test('resolves Cursor proxy settings and honors NO_PROXY for Cursor hosts', () => {
    process.env['TOKENLEAK_CURSOR_PROXY'] = 'http://user:secret@proxy.company:8080';
    process.env['HTTPS_PROXY'] = 'http://fallback.company:8080';

    expect(resolveCursorNetworkSettings('https://cursor.com/api/usage-summary')).toMatchObject({
      proxy: 'http://user:secret@proxy.company:8080',
      proxySource: 'TOKENLEAK_CURSOR_PROXY',
      noProxyMatched: false,
    });

    process.env['NO_PROXY'] = '.cursor.com,localhost';
    expect(resolveCursorNetworkSettings('https://www.cursor.com/settings')).toMatchObject({
      proxy: undefined,
      proxySource: undefined,
      noProxyMatched: true,
    });
  });

  test('resolves Cursor CA file and timeout settings for fetch', () => {
    const caPath = join(tempRoot, 'company-root-ca.pem');
    writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n');
    process.env['TOKENLEAK_CURSOR_CA_FILE'] = caPath;
    process.env['TOKENLEAK_CURSOR_TIMEOUT_MS'] = '45000';

    const settings = resolveCursorNetworkSettings('https://cursor.com/api/usage-summary');

    expect(settings.timeoutMs).toBe(45000);
    expect(settings.caFile).toBe(caPath);
    expect(settings.tls?.ca).toContain('BEGIN CERTIFICATE');
  });

  test('classifies DNS, TLS, proxy, and timeout network errors', () => {
    expect(classifyCursorNetworkError(new Error('getaddrinfo ENOTFOUND cursor.com')).kind).toBe('dns');
    expect(classifyCursorNetworkError(new Error('self signed certificate in certificate chain')).kind).toBe('tls');
    expect(classifyCursorNetworkError(new Error('Proxy CONNECT aborted while tunneling')).kind).toBe('proxy');

    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    expect(classifyCursorNetworkError(aborted).kind).toBe('timeout');
  });

  test('diagnoses Cursor reachability without leaking token or proxy secrets', async () => {
    process.env['TOKENLEAK_CURSOR_PROXY'] = 'http://user:secret@proxy.company:8080';
    saveCursorCredentials('user-work::super-secret-token', 'work');
    const cookies: string[] = [];

    globalThis.fetch = (async (url, init) => {
      cookies.push(String((init?.headers as Record<string, string> | undefined)?.['Cookie'] ?? ''));
      const hasToken = cookies.at(-1)?.includes('super-secret-token') ?? false;
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

    const result = await diagnoseCursorConnection({
      credentials: { sessionToken: 'user-work::super-secret-token' },
      includeToken: true,
    });

    expect(result.network.proxy).toBe('http://***:***@proxy.company:8080');
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('super-secret-token');
    expect(JSON.stringify(result)).not.toContain('user:secret');
    expect(cookies.some((cookie) => cookie.includes('super-secret-token'))).toBe(true);
  });
});
