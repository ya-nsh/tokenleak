import { describe, expect, test } from 'bun:test';
import { QuotaClient, quotaRetryDelay } from './client';
import { normalizeQuota } from './normalize';
import { discoverQuotaCredential, type CredentialIO } from './credentials';

const NOW = Date.parse('2026-09-06T12:00:00Z');
const RESET = '2026-09-06T15:00:00.000Z';
const claude = { five_hour: { utilization: 25, resets_at: RESET }, seven_day: { utilization: 0 } };
const codex = {
  plan_type: 'pro',
  rate_limit: {
    primary_window: {
      used_percent: 80,
      limit_window_seconds: 18000,
      reset_at: Date.parse(RESET) / 1000,
    },
  },
};
const missing = () => {
  throw Object.assign(new Error('missing'), { code: 'ENOENT' });
};
const io = (overrides: Partial<CredentialIO> = {}): CredentialIO => ({
  home: '/fixture',
  env: {},
  platform: 'linux',
  read: async () => missing(),
  canonical: async (path) => path,
  command: async () => {
    throw new Error('not installed');
  },
  ...overrides,
});

function harness() {
  let now = NOW;
  let secret = 'secret-one';
  let calls = 0;
  let response = () => Promise.resolve(Response.json(claude));
  const requests: RequestInit[] = [];
  const client = new QuotaClient({
    now: () => now,
    credential: async () => (secret ? { token: secret, accountId: 'private-account' } : null),
    fetch: (async (_url, options) => {
      calls++;
      requests.push(options!);
      return response();
    }) as typeof fetch,
  });
  return {
    client,
    requests,
    calls: () => calls,
    advance: (ms: number) => {
      now += ms;
    },
    secret: (value: string) => {
      secret = value;
    },
    response: (value: typeof response) => {
      response = value;
    },
  };
}

describe('quota normalization', () => {
  test('Claude zero usage, unknown reset and scoped limits remain distinct', () => {
    const result = normalizeQuota('claude', {
      ...claude,
      seven_day_sonnet: { utilization: 20 },
      limits: [
        {
          kind: 'weekly_scoped',
          percent: 42,
          is_active: false,
          scope: { model: { display_name: 'Sonnet' } },
        },
      ],
    });
    expect(result.windows.map((w) => w.remainingPercent)).toEqual([75, 100, 58]);
    expect(result.windows[1]!.resetsAt).toBeNull();
  });
  test('Claude new limits-only payload is supported', () => {
    expect(
      normalizeQuota('claude', {
        limits: [
          { kind: 'session', percent: 40 },
          { kind: 'weekly_all', percent: 60 },
        ],
      }).windows.map((w) => w.remainingPercent),
    ).toEqual([60, 40]);
  });
  test('Codex window duration, epoch reset and additional buckets', () => {
    const result = normalizeQuota('codex', {
      ...codex,
      additional_rate_limits: [
        {
          limit_name: 'Review',
          rate_limit: { secondary_window: { used_percent: 105, limit_window_seconds: 604800 } },
        },
      ],
    });
    expect(result.plan).toBe('pro');
    expect(result.windows[0]).toMatchObject({
      label: 'Codex Session (5h)',
      remainingPercent: 20,
      resetsAt: RESET,
    });
    expect(result.windows[1]).toMatchObject({
      label: 'Review Weekly',
      usedPercent: 105,
      remainingPercent: 0,
    });
  });
  test('malformed and null values never mean full capacity', () => {
    for (const value of [null, undefined, NaN, -5, '20', Infinity]) {
      expect(
        normalizeQuota('claude', { five_hour: { utilization: value, resets_at: 'bad-date' } })
          .windows[0],
      ).toMatchObject({ usedPercent: null, remainingPercent: null, resetsAt: null });
    }
    expect(normalizeQuota('codex', null).windows).toEqual([]);
  });
  test('Copilot paid, unlimited, unknown and free plans', () => {
    const paid = normalizeQuota('copilot', {
      copilot_plan: 'individual',
      quota_reset_date: '2026-10-01',
      quota_snapshots: {
        premium_interactions: { remaining: 150, entitlement: 300 },
        chat: { unlimited: true },
        unknown: {},
      },
    });
    expect(paid.windows[0]!.remainingPercent).toBe(50);
    expect(paid.windows[1]).toMatchObject({ unlimited: true, remainingPercent: null });
    expect(paid.windows[2]!.remainingPercent).toBeNull();
    const free = normalizeQuota('copilot', {
      limited_user_quotas: { chat: 10 },
      monthly_quotas: { chat: 50 },
    });
    expect(free.windows[0]!.remainingPercent).toBe(20);
  });
  test('vendor strings cannot inject terminal control characters', () => {
    expect(normalizeQuota('codex', { ...codex, plan_type: 'pro\n\x1b[2J' }).plan).toBe('pro[2J');
  });
});

describe('credential discovery', () => {
  test('reads configured Claude root and only returns access token', async () => {
    const paths: string[] = [];
    const result = await discoverQuotaCredential(
      'claude',
      io({
        env: { CLAUDE_CONFIG_DIR: '/custom' },
        read: async (path) => {
          paths.push(path);
          return JSON.stringify({
            claudeAiOauth: { accessToken: 'secret', refreshToken: 'never-return' },
          });
        },
      }),
    );
    expect(paths).toEqual(['/custom/.credentials.json']);
    expect(result).toEqual({ token: 'secret' });
  });
  test('Codex honors CODEX_HOME and account id, rejects API-only auth', async () => {
    const result = await discoverQuotaCredential(
      'codex',
      io({
        env: { CODEX_HOME: '/custom' },
        read: async (path) => {
          expect(path).toBe('/custom/auth.json');
          return JSON.stringify({ tokens: { access_token: 'token', account_id: 'account' } });
        },
      }),
    );
    expect(result).toEqual({ token: 'token', accountId: 'account' });
    expect(
      await discoverQuotaCredential(
        'codex',
        io({ read: async () => '{"auth_mode":"apikey","tokens":{"access_token":"old"}}' }),
      ),
    ).toBeNull();
  });
  test('macOS keychain is bounded to the requested service/account', async () => {
    const seen: string[][] = [];
    const options = io({
      platform: 'darwin',
      command: async (file, args) => {
        expect(file).toBe('/usr/bin/security');
        seen.push(args);
        return '{"tokens":{"access_token":"token"},"claudeAiOauth":{"accessToken":"claude-token"}}';
      },
    });
    expect(await discoverQuotaCredential('codex', options)).toEqual({ token: 'token' });
    expect(seen[0]!.join(' ')).toMatch(/Codex Auth -a cli\|[a-f0-9]{16} -w/);
    expect(await discoverQuotaCredential('claude', options)).toEqual({ token: 'claude-token' });
    expect(seen[1]).toEqual(['find-generic-password', '-s', 'Claude Code-credentials', '-w']);
  });
  test('custom Claude config never falls back to unrelated default keychain', async () => {
    expect(
      await discoverQuotaCredential(
        'claude',
        io({
          platform: 'darwin',
          env: { CLAUDE_CONFIG_DIR: '/other' },
          command: async () => {
            throw new Error('must not call');
          },
        }),
      ),
    ).toBeNull();
  });
  test('Copilot env token precedence and gh command arguments', async () => {
    expect(
      await discoverQuotaCredential(
        'copilot',
        io({ env: { GH_TOKEN: 'first', GITHUB_TOKEN: 'second' } }),
      ),
    ).toEqual({ token: 'first' });
    expect(
      await discoverQuotaCredential(
        'copilot',
        io({
          command: async (file, args) => {
            expect(file).toBe('gh');
            expect(args).toEqual(['auth', 'token', '--hostname', 'github.com']);
            return 'from-gh\n';
          },
        }),
      ),
    ).toEqual({ token: 'from-gh' });
  });
  test('missing credentials, malformed storage and unsafe tokens', async () => {
    expect(await discoverQuotaCredential('claude', io())).toBeNull();
    expect(await discoverQuotaCredential('copilot', io())).toBeNull();
    await expect(
      discoverQuotaCredential('codex', io({ read: async () => 'bad-json' })),
    ).rejects.toThrow('Credential storage');
    expect(
      await discoverQuotaCredential(
        'codex',
        io({ read: async () => '{"tokens":{"access_token":"bad\\r\\nheader"}}' }),
      ),
    ).toBeNull();
  });
});

describe('quota client', () => {
  test('successful normalized snapshot never contains credentials or account identifiers', async () => {
    const h = harness();
    const snapshot = await h.client.load(['claude']);
    expect(snapshot.providers[0]).toMatchObject({
      status: 'ready',
      stale: false,
      fetchedAt: new Date(NOW).toISOString(),
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(JSON.stringify(snapshot)).not.toContain('private-account');
    expect(h.requests[0]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { 'anthropic-beta': 'oauth-2025-04-20' },
    });
  });
  test('deduplicates overlapping requests, caches, and respects manual cooldown', async () => {
    const h = harness();
    await Promise.all([h.client.load(['claude']), h.client.load(['claude'])]);
    expect(h.calls()).toBe(1);
    await h.client.load(['claude'], true);
    expect(h.calls()).toBe(1);
    h.advance(16000);
    await h.client.load(['claude']);
    expect(h.calls()).toBe(1);
    await h.client.load(['claude'], true);
    expect(h.calls()).toBe(2);
  });
  test('failed refresh keeps prior reading visibly stale with original timestamp', async () => {
    const h = harness();
    await h.client.load(['claude']);
    h.advance(61000);
    h.response(async () => {
      throw new Error('SECRET upstream exception');
    });
    const result = (await h.client.load(['claude'])).providers[0]!;
    expect(result).toMatchObject({
      status: 'unavailable',
      stale: true,
      fetchedAt: new Date(NOW).toISOString(),
    });
    expect(result.windows[0]!.remainingPercent).toBe(75);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  test('auth rejection clears prior data and does not leak response bodies', async () => {
    const h = harness();
    await h.client.load(['claude']);
    h.advance(61000);
    h.response(async () => new Response('secret-one', { status: 401 }));
    const result = (await h.client.load(['claude'])).providers[0]!;
    expect(result).toMatchObject({ status: 'auth-required', stale: false, windows: [] });
    expect(JSON.stringify(result)).not.toContain('secret-one');
  });
  test('account change and logout invalidate cached data', async () => {
    const h = harness();
    await h.client.load(['claude']);
    h.secret('new-account');
    h.response(async () => new Response('{}', { status: 503 }));
    expect((await h.client.load(['claude'])).providers[0]!.windows).toEqual([]);
    expect(h.calls()).toBe(2);
    h.secret('');
    expect((await h.client.load(['claude'])).providers[0]!.status).toBe('not-configured');
  });
  test('429 cooldown cannot be bypassed by force-refresh', async () => {
    const h = harness();
    h.response(async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }));
    const result = (await h.client.load(['claude'])).providers[0]!;
    expect(result.status).toBe('rate-limited');
    h.advance(61000);
    await h.client.load(['claude'], true);
    expect(h.calls()).toBe(1);
    h.advance(60000);
    await h.client.load(['claude'], true);
    expect(h.calls()).toBe(2);
  });
  test('Retry-After HTTP dates and invalid values are bounded', () => {
    expect(quotaRetryDelay(new Date(NOW + 120000).toUTCString(), NOW)).toBe(120000);
    expect(quotaRetryDelay('999999999', NOW)).toBe(3600000);
    expect(quotaRetryDelay('invalid', NOW)).toBe(60000);
    expect(quotaRetryDelay(null, NOW)).toBe(60000);
  });
  test('provider failures are isolated, invalid payloads are unavailable', async () => {
    const client = new QuotaClient({
      now: () => NOW,
      credential: async (id) => {
        if (id === 'copilot') throw new Error('private storage detail');
        return { token: 'secret' };
      },
      fetch: (async (url) =>
        Response.json(String(url).includes('wham') ? codex : {})) as typeof fetch,
    });
    const snapshot = await client.load();
    expect(snapshot.providers.map((p) => p.status)).toEqual([
      'unavailable',
      'ready',
      'unavailable',
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('private storage detail');
  });
  test('expired reset does not fabricate a renewed quota', async () => {
    const h = harness();
    h.response(async () =>
      Response.json({ five_hour: { utilization: 100, resets_at: '2026-09-01' } }),
    );
    expect((await h.client.load(['claude'])).providers[0]!.windows[0]!.remainingPercent).toBe(0);
  });
});

test('quota timeout aborts fetch and returns a sanitized unavailable state', async () => {
  const client = new QuotaClient({
    now: () => NOW,
    timeoutMs: 5,
    credential: async () => ({ token: 'secret' }),
    fetch: (async (_url, options) =>
      new Promise<Response>((_resolve, reject) =>
        options!.signal!.addEventListener('abort', () => reject(new Error('SECRET timeout'))),
      )) as typeof fetch,
  });
  const result = (await client.load(['claude'])).providers[0]!;
  expect(result.status).toBe('unavailable');
  expect(result.message).toContain('timed out');
  expect(JSON.stringify(result)).not.toContain('SECRET');
});
test('malformed and oversized provider responses fail closed', async () => {
  for (const body of ['not json', 'x'.repeat(1_048_577)]) {
    const h = harness();
    h.response(async () => new Response(body));
    expect((await h.client.load(['claude'])).providers[0]!.status).toBe('unavailable');
  }
});
test('Codex and Copilot credentials go only to their fixed HTTPS endpoints', async () => {
  const seen: string[] = [];
  const client = new QuotaClient({
    now: () => NOW,
    credential: async () => ({ token: 'secret', accountId: 'account' }),
    fetch: (async (url, options) => {
      seen.push(String(url));
      const headers = options!.headers as Record<string, string>;
      if (String(url).includes('wham')) expect(headers['ChatGPT-Account-Id']).toBe('account');
      else {
        expect(headers['ChatGPT-Account-Id']).toBeUndefined();
        expect(headers.Authorization).toBe('token secret');
      }
      return Response.json(codex);
    }) as typeof fetch,
  });
  await client.load(['codex', 'copilot']);
  expect(seen).toEqual([
    'https://chatgpt.com/backend-api/wham/usage',
    'https://api.github.com/copilot_internal/user',
  ]);
});
