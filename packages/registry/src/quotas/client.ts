import { createHash } from 'node:crypto';
import type { ProviderQuota, QuotaProvider, QuotaSnapshot } from '@tokenleak/core';
import { discoverQuotaCredential, type QuotaCredential } from './credentials';
import { normalizeQuota } from './normalize';

export const QUOTA_PROVIDERS: QuotaProvider[] = ['claude', 'codex', 'copilot'];
const ENDPOINTS: Record<QuotaProvider, string> = {
  claude: 'https://api.anthropic.com/api/oauth/usage',
  codex: 'https://chatgpt.com/backend-api/wham/usage',
  copilot: 'https://api.github.com/copilot_internal/user',
};
const LOGIN: Record<QuotaProvider, string> = {
  claude: 'Sign in with Claude Code using /login.',
  codex: 'Run codex login with a ChatGPT subscription (API keys do not expose plan quotas).',
  copilot: 'Run gh auth login for github.com with a Copilot-enabled account.',
};
const CACHE_MS = 60_000;
const MIN_REFRESH_MS = 15_000;
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_048_576;
async function readPayload(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Empty quota response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Quota response too large.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Inject transport, credentials and clock; tests never require real accounts. */
export interface QuotaDependencies {
  credential(provider: QuotaProvider): Promise<QuotaCredential | null>;
  fetch: typeof globalThis.fetch;
  now(): number;
  timeoutMs?: number;
}
interface Entry {
  fingerprint: string;
  result: ProviderQuota;
  attemptedAt: number;
  nextAttempt: number;
}

/** Parse Retry-After seconds or HTTP date, bounded to 1 minute–1 hour. */
export function quotaRetryDelay(value: string | null, now: number): number {
  const numeric = value?.trim() ? Number(value) : NaN;
  const delay = Number.isFinite(numeric) ? numeric * 1000 : value ? Date.parse(value) - now : NaN;
  return Number.isFinite(delay) ? Math.min(3_600_000, Math.max(CACHE_MS, delay)) : CACHE_MS;
}

/** In-memory, credential-scoped quota cache with independent provider failures. */
export class QuotaClient {
  private cache = new Map<QuotaProvider, Entry>();
  private pending = new Map<QuotaProvider, Promise<ProviderQuota>>();
  constructor(
    private deps: QuotaDependencies = {
      credential: discoverQuotaCredential,
      fetch: globalThis.fetch,
      now: Date.now,
    },
  ) {}

  /** Fetch selected providers concurrently; normal historical reads never call this. */
  async load(
    providers: QuotaProvider[] = QUOTA_PROVIDERS,
    refresh = false,
  ): Promise<QuotaSnapshot> {
    const selected = [...new Set(providers)];
    if (selected.some((id) => !QUOTA_PROVIDERS.includes(id)))
      throw new Error('Unsupported quota provider.');
    const results = await Promise.all(
      selected.map((id) => {
        const existing = this.pending.get(id);
        if (existing) return existing;
        const task = this.loadProvider(id, refresh).finally(() => this.pending.delete(id));
        this.pending.set(id, task);
        return task;
      }),
    );
    return {
      schemaVersion: 1,
      checkedAt: new Date(this.deps.now()).toISOString(),
      providers: results,
    };
  }

  private async loadProvider(provider: QuotaProvider, refresh: boolean): Promise<ProviderQuota> {
    const now = this.deps.now();
    const empty: ProviderQuota = {
      provider,
      status: 'unavailable',
      plan: null,
      windows: [],
      fetchedAt: null,
      stale: false,
      message: null,
      retryAt: null,
    };
    let credential: QuotaCredential | null;
    try {
      credential = await this.deps.credential(provider);
    } catch {
      this.cache.delete(provider);
      return { ...empty, message: `Cannot read credential storage. ${LOGIN[provider]}` };
    }
    if (!credential) {
      this.cache.delete(provider);
      return { ...empty, status: 'not-configured', message: LOGIN[provider] };
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(credential)).digest('hex');
    let previous = this.cache.get(provider);
    if (previous?.fingerprint !== fingerprint) {
      this.cache.delete(provider);
      previous = undefined;
    }
    if (
      previous &&
      (now < previous.nextAttempt || (!refresh && now - previous.attemptedAt < CACHE_MS))
    ) {
      return previous.result;
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.token}`,
      Accept: 'application/json',
      'User-Agent': 'tokenleak',
    };
    if (provider === 'claude') headers['anthropic-beta'] = 'oauth-2025-04-20';
    if (provider === 'codex' && credential.accountId)
      headers['ChatGPT-Account-Id'] = credential.accountId;
    if (provider === 'copilot') {
      headers.Authorization = `token ${credential.token}`;
      headers['Editor-Version'] = 'vscode/1.96.2';
      headers['Editor-Plugin-Version'] = 'copilot-chat/0.26.7';
      headers['X-Github-Api-Version'] = '2025-04-01';
    }
    let result: ProviderQuota;
    let nextAttempt = now + MIN_REFRESH_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs ?? TIMEOUT_MS);
    try {
      const response = await this.deps.fetch(ENDPOINTS[provider], {
        method: 'GET',
        headers,
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 401 || response.status === 403) {
        result = {
          ...empty,
          status: 'auth-required',
          message: `Credentials rejected or quota access denied. ${LOGIN[provider]}`,
        };
        nextAttempt = now + CACHE_MS;
      } else if (response.status === 429) {
        nextAttempt = now + quotaRetryDelay(response.headers.get('retry-after'), now);
        result = {
          ...empty,
          status: 'rate-limited',
          message: 'Provider rate limited quota requests. Wait before refreshing.',
          retryAt: new Date(nextAttempt).toISOString(),
        };
      } else if (!response.ok) {
        result = {
          ...empty,
          message: `Provider unavailable (HTTP ${response.status}). Try refreshing later.`,
        };
      } else {
        const parsed = normalizeQuota(provider, await readPayload(response));
        const usable = parsed.windows.some(
          (bucket) => bucket.usedPercent !== null || bucket.unlimited,
        );
        result = {
          ...empty,
          ...parsed,
          status: usable ? 'ready' : 'unavailable',
          fetchedAt: usable ? new Date(this.deps.now()).toISOString() : null,
          message: usable
            ? null
            : 'Provider returned no usable subscription quotas for this account.',
        };
      }
      // Never retain a credential-bearing error body or vendor error message.
      if (!response.ok) await response.body?.cancel();
    } catch {
      result = {
        ...empty,
        message: controller.signal.aborted
          ? 'Quota request timed out. Try refreshing later.'
          : 'Could not fetch quota data. Check connectivity and try refreshing.',
      };
    } finally {
      clearTimeout(timer);
    }
    if (
      (result.status === 'unavailable' || result.status === 'rate-limited') &&
      previous?.result.fetchedAt
    ) {
      result = {
        ...result,
        plan: previous.result.plan,
        windows: previous.result.windows,
        fetchedAt: previous.result.fetchedAt,
        stale: true,
      };
    }
    this.cache.set(provider, { fingerprint, result, attemptedAt: now, nextAttempt });
    return result;
  }
}
/** Shared within one CLI/TUI/MCP process. Nothing is persisted to disk. */
export const quotaClient = new QuotaClient();
