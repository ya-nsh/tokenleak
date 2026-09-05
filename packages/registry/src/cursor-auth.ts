import { VERSION } from '@tokenleak/core';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const CURSOR_USAGE_CSV_ENDPOINT =
  'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';
const CURSOR_USAGE_SUMMARY_ENDPOINT = 'https://cursor.com/api/usage-summary';

export type CursorFailureReason =
  | 'auth'
  | 'not_authenticated'
  | 'network'
  | 'api'
  | 'parse'
  | 'unknown'
  | 'partial';

export type CursorSetupState =
  | 'ready'
  | 'needs_auth'
  | 'needs_sync'
  | 'needs_reauth'
  | 'sync_failed_cached';

export class CursorAuthError extends Error {
  readonly code: CursorFailureReason;

  constructor(message: string, code: CursorFailureReason = 'unknown') {
    super(message);
    this.name = 'CursorAuthError';
    this.code = code;
  }
}

export interface CursorCredentials {
  sessionToken: string;
  userId?: string;
  createdAt: string;
  expiresAt?: string;
  label?: string;
}

export interface CursorCredentialsStore {
  version: number;
  activeAccountId: string;
  accounts: Record<string, CursorCredentials>;
}

export interface CursorAccountInfo {
  id: string;
  label?: string;
  userId?: string;
  createdAt: string;
  isActive: boolean;
}

export interface ValidateCursorSessionResult {
  valid: boolean;
  membershipType?: string;
  error?: string;
  reason?: CursorFailureReason;
}

export interface SyncCursorResult {
  synced: boolean;
  rows: number;
  error?: string;
  reason?: CursorFailureReason;
  activeAccountSynced?: boolean;
}

export interface CursorSetupStatus {
  state: CursorSetupState;
  hasCredentials: boolean;
  hasCache: boolean;
  error?: string;
  reason?: CursorFailureReason;
  activeAccountId?: string;
  activeAccountLabel?: string;
}

function getCursorRootDir(): string {
  return process.env['TOKENLEAK_CURSOR_DIR'] ?? join(homedir(), '.config', 'tokenleak');
}

export function getCursorCredentialsPath(): string {
  return join(getCursorRootDir(), 'cursor-credentials.json');
}

export function getCursorCacheDir(): string {
  return join(getCursorRootDir(), 'cursor-cache');
}

function ensureDir(dirPath: string, mode?: number): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  if (mode !== undefined && process.platform !== 'win32') {
    chmodSync(dirPath, mode);
  }
}

function atomicWriteFile(path: string, contents: string, mode?: number): void {
  const dir = dirname(path);
  ensureDir(dir);
  const tempPath = join(dir, `.tmp-${basename(path)}-${process.pid}`);
  writeFileSync(tempPath, contents, 'utf8');
  if (mode !== undefined && process.platform !== 'win32') {
    chmodSync(tempPath, mode);
  }
  renameSync(tempPath, path);
}

const CURSOR_FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CURSOR_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CursorAuthError(
        `Failed to connect: request timed out after ${CURSOR_FETCH_TIMEOUT_MS}ms`,
        'network',
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCursorHeaders(sessionToken: string): Record<string, string> {
  return {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Cookie: `WorkosCursorSessionToken=${sessionToken}`,
    Referer: 'https://www.cursor.com/settings',
    'User-Agent': `tokenleak/${VERSION} (+https://github.com/ya-nsh/tokenleak)`,
  };
}

function sanitizeAccountIdForFilename(accountId: string): string {
  const sanitized = accountId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized.slice(0, 80) : 'account';
}

function extractUserIdFromSessionToken(token: string): string | undefined {
  const trimmed = token.trim();
  if (trimmed.includes('%3A%3A')) {
    return trimmed.split('%3A%3A')[0]?.trim() || undefined;
  }
  if (trimmed.includes('::')) {
    return trimmed.split('::')[0]?.trim() || undefined;
  }
  return undefined;
}

function deriveAccountId(sessionToken: string): string {
  const userId = extractUserIdFromSessionToken(sessionToken);
  if (userId) {
    return userId;
  }

  const hash = createHash('sha256').update(sessionToken).digest('hex');
  return `anon-${hash.slice(0, 12)}`;
}

function countCursorCsvRows(csvText: string): number {
  const rows = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return rows.length > 0 ? rows.length - 1 : 0;
}

function archiveCacheFile(path: string, label: string): void {
  if (!existsSync(path)) {
    return;
  }

  const archiveDir = join(getCursorCacheDir(), 'archive');
  ensureDir(archiveDir, 0o700);
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  renameSync(path, join(archiveDir, `${sanitizeAccountIdForFilename(label)}-${timestamp}.csv`));
}

function resolveAccountId(
  store: CursorCredentialsStore,
  nameOrId: string,
): string | undefined {
  const needle = nameOrId.trim();
  if (!needle) {
    return undefined;
  }

  if (store.accounts[needle]) {
    return needle;
  }

  const lowered = needle.toLowerCase();
  for (const [id, account] of Object.entries(store.accounts)) {
    if (account.label?.toLowerCase() === lowered) {
      return id;
    }
  }

  return undefined;
}

function getActiveAccountMeta(store: CursorCredentialsStore | null): {
  activeAccountId?: string;
  activeAccountLabel?: string;
} {
  if (!store) {
    return {};
  }

  const active = store.accounts[store.activeAccountId];
  return {
    activeAccountId: store.activeAccountId,
    activeAccountLabel: active?.label,
  };
}

function toFailureReason(error: unknown): CursorFailureReason {
  if (error instanceof CursorAuthError) {
    return error.code;
  }
  return 'unknown';
}

export function isCursorAuthFailureReason(reason?: CursorFailureReason): boolean {
  return reason === 'auth' || reason === 'not_authenticated';
}

export function loadCursorCredentialsStore(): CursorCredentialsStore | null {
  const path = getCursorCredentialsPath();
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CursorCredentialsStore;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.activeAccountId !== 'string' ||
      typeof parsed.accounts !== 'object' ||
      parsed.accounts === null
    ) {
      return null;
    }

    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      activeAccountId: parsed.activeAccountId,
      accounts: parsed.accounts,
    };
  } catch {
    return null;
  }
}

export function saveCursorCredentialsStore(store: CursorCredentialsStore): void {
  ensureDir(getCursorRootDir(), 0o700);
  atomicWriteFile(
    getCursorCredentialsPath(),
    `${JSON.stringify(store, null, 2)}\n`,
    process.platform === 'win32' ? undefined : 0o600,
  );
}

export function listCursorAccounts(): CursorAccountInfo[] {
  const store = loadCursorCredentialsStore();
  if (!store) {
    return [];
  }

  return Object.entries(store.accounts)
    .map(([id, account]) => ({
      id,
      label: account.label,
      userId: account.userId,
      createdAt: account.createdAt,
      isActive: id === store.activeAccountId,
    }))
    .sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }

      return (left.label ?? left.id).localeCompare(right.label ?? right.id);
    });
}

export function hasCursorUsageCache(): boolean {
  const cacheDir = getCursorCacheDir();
  if (!existsSync(cacheDir)) {
    return false;
  }

  return readdirSync(cacheDir).some((entry) => {
    if (entry === 'archive') {
      return false;
    }
    return entry === 'usage.csv' || (/^usage\.[^.].*\.csv$/).test(entry);
  });
}

export function isCursorLoggedIn(): boolean {
  const store = loadCursorCredentialsStore();
  return store !== null && Object.keys(store.accounts).length > 0;
}

export function saveCursorCredentials(token: string, label?: string): string {
  const accountId = deriveAccountId(token);
  const store = loadCursorCredentialsStore() ?? {
    version: 1,
    activeAccountId: accountId,
    accounts: {},
  };

  const normalizedLabel = label?.trim();
  if (normalizedLabel) {
    for (const [id, account] of Object.entries(store.accounts)) {
      if (id === accountId) {
        continue;
      }
      if (account.label?.trim().toLowerCase() === normalizedLabel.toLowerCase()) {
        throw new CursorAuthError(`Cursor account label already exists: ${normalizedLabel}`);
      }
    }
  }

  store.accounts[accountId] = {
    sessionToken: token,
    userId: extractUserIdFromSessionToken(token),
    createdAt: new Date().toISOString(),
    label: normalizedLabel,
  };
  store.activeAccountId = accountId;
  saveCursorCredentialsStore(store);
  return accountId;
}

export function removeCursorAccount(nameOrId: string, purgeCache: boolean): void {
  const store = loadCursorCredentialsStore();
  if (!store) {
    throw new CursorAuthError('No saved Cursor accounts');
  }

  const accountId = resolveAccountId(store, nameOrId);
  if (!accountId) {
    throw new CursorAuthError(`Account not found: ${nameOrId}`);
  }

  const wasActive = accountId === store.activeAccountId;
  const cacheDir = getCursorCacheDir();
  const accountCachePath = join(cacheDir, `usage.${sanitizeAccountIdForFilename(accountId)}.csv`);
  const activeCachePath = join(cacheDir, 'usage.csv');

  if (existsSync(accountCachePath)) {
    if (purgeCache) {
      unlinkSync(accountCachePath);
    } else {
      archiveCacheFile(accountCachePath, `usage.${accountId}`);
    }
  }

  if (wasActive && existsSync(activeCachePath)) {
    if (purgeCache) {
      unlinkSync(activeCachePath);
    } else {
      archiveCacheFile(activeCachePath, `usage.active.${accountId}`);
    }
  }

  delete store.accounts[accountId];

  const remainingIds = Object.keys(store.accounts);
  if (remainingIds.length === 0) {
    if (existsSync(getCursorCredentialsPath())) {
      unlinkSync(getCursorCredentialsPath());
    }
    return;
  }

  if (wasActive) {
    const nextAccountId = remainingIds[0]!;
    store.activeAccountId = nextAccountId;
    const nextCachePath = join(cacheDir, `usage.${sanitizeAccountIdForFilename(nextAccountId)}.csv`);
    if (existsSync(nextCachePath)) {
      renameSync(nextCachePath, activeCachePath);
    }
  }

  saveCursorCredentialsStore(store);
}

export function removeAllCursorAccounts(purgeCache: boolean): void {
  const cacheDir = getCursorCacheDir();
  if (existsSync(cacheDir)) {
    for (const entry of readdirSync(cacheDir)) {
      if (entry === 'archive') {
        if (purgeCache) {
          rmSync(join(cacheDir, entry), { recursive: true, force: true });
        }
        continue;
      }

      if (entry === 'usage.csv' || (/^usage\.[^.].*\.csv$/).test(entry)) {
        const fullPath = join(cacheDir, entry);
        if (purgeCache) {
          rmSync(fullPath, { force: true });
        } else {
          archiveCacheFile(fullPath, `usage.all.${entry}`);
        }
      }
    }
  }

  if (existsSync(getCursorCredentialsPath())) {
    unlinkSync(getCursorCredentialsPath());
  }
}

export function resetCursorProviderState(): void {
  removeAllCursorAccounts(true);
}

export function setActiveCursorAccount(nameOrId: string): void {
  const store = loadCursorCredentialsStore();
  if (!store) {
    throw new CursorAuthError('No saved Cursor accounts');
  }

  const accountId = resolveAccountId(store, nameOrId);
  if (!accountId) {
    throw new CursorAuthError(`Account not found: ${nameOrId}`);
  }

  if (accountId === store.activeAccountId) {
    return;
  }

  const cacheDir = getCursorCacheDir();
  const activeCachePath = join(cacheDir, 'usage.csv');
  const oldActivePath = join(cacheDir, `usage.${sanitizeAccountIdForFilename(store.activeAccountId)}.csv`);
  const newActivePath = join(cacheDir, `usage.${sanitizeAccountIdForFilename(accountId)}.csv`);

  if (existsSync(activeCachePath)) {
    if (existsSync(oldActivePath)) {
      archiveCacheFile(oldActivePath, `usage.${store.activeAccountId}`);
    }
    renameSync(activeCachePath, oldActivePath);
  }

  if (existsSync(newActivePath)) {
    renameSync(newActivePath, activeCachePath);
  }

  store.activeAccountId = accountId;
  saveCursorCredentialsStore(store);
}

export function getActiveCursorCredentials(): CursorCredentials | null {
  const store = loadCursorCredentialsStore();
  if (!store) {
    return null;
  }

  return store.accounts[store.activeAccountId] ?? null;
}

export function getCursorCredentialsFor(nameOrId: string): CursorCredentials | null {
  const store = loadCursorCredentialsStore();
  if (!store) {
    return null;
  }

  const accountId = resolveAccountId(store, nameOrId);
  return accountId ? (store.accounts[accountId] ?? null) : null;
}

export async function validateCursorSession(sessionToken: string): Promise<ValidateCursorSessionResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(CURSOR_USAGE_SUMMARY_ENDPOINT, {
      headers: buildCursorHeaders(sessionToken),
    });
  } catch (error: unknown) {
    return {
      valid: false,
      error: `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
      reason: 'network',
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      valid: false,
      error: 'Session token expired or invalid',
      reason: 'auth',
    };
  }

  if (!response.ok) {
    return {
      valid: false,
      error: `API returned status ${response.status}`,
      reason: 'api',
    };
  }

  try {
    const payload = await response.json() as Record<string, unknown>;
    const billingCycleStart = payload['billingCycleStart'];
    const billingCycleEnd = payload['billingCycleEnd'];
    if (typeof billingCycleStart !== 'string' || typeof billingCycleEnd !== 'string') {
      return {
        valid: false,
        error: 'Invalid response format',
        reason: 'parse',
      };
    }

    return {
      valid: true,
      membershipType: typeof payload['membershipType'] === 'string'
        ? payload['membershipType']
        : undefined,
    };
  } catch (error: unknown) {
    return {
      valid: false,
      error: `Failed to parse response: ${error instanceof Error ? error.message : String(error)}`,
      reason: 'parse',
    };
  }
}

async function fetchCursorUsageCsv(sessionToken: string): Promise<string> {
  let response: Response;
  try {
    response = await fetchWithTimeout(CURSOR_USAGE_CSV_ENDPOINT, {
      headers: buildCursorHeaders(sessionToken),
    });
  } catch (error: unknown) {
    if (error instanceof CursorAuthError) {
      throw error;
    }
    throw new CursorAuthError(
      `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
      'network',
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new CursorAuthError(
      "Cursor session expired. Please run 'tokenleak cursor login' to re-authenticate.",
      'auth',
    );
  }

  if (!response.ok) {
    throw new CursorAuthError(`Cursor API returned status ${response.status}`, 'api');
  }

  const text = await response.text();
  if (!text.startsWith('Date,')) {
    throw new CursorAuthError('Invalid response from Cursor API - expected CSV format', 'parse');
  }

  return text;
}

export async function syncCursorCache(): Promise<SyncCursorResult> {
  const store = loadCursorCredentialsStore();
  if (!store || Object.keys(store.accounts).length === 0) {
    return { synced: false, rows: 0, error: 'Not authenticated', reason: 'not_authenticated' };
  }

  const cacheDir = getCursorCacheDir();
  ensureDir(cacheDir, 0o700);

  let totalRows = 0;
  let successCount = 0;
  const errors: Array<{ accountId: string; message: string; reason: CursorFailureReason }> = [];
  let activeAccountSynced = false;
  let activeAccountFailure: { message: string; reason: CursorFailureReason } | null = null;

  for (const [accountId, credentials] of Object.entries(store.accounts)) {
    try {
      const csvText = await fetchCursorUsageCsv(credentials.sessionToken);
      const filePath = accountId === store.activeAccountId
        ? join(cacheDir, 'usage.csv')
        : join(cacheDir, `usage.${sanitizeAccountIdForFilename(accountId)}.csv`);
      atomicWriteFile(filePath, csvText, process.platform === 'win32' ? undefined : 0o600);
      if (accountId === store.activeAccountId) {
        const activeDupPath = join(
          cacheDir,
          `usage.${sanitizeAccountIdForFilename(store.activeAccountId)}.csv`,
        );
        if (existsSync(activeDupPath)) {
          unlinkSync(activeDupPath);
        }
      }
      successCount += 1;
      totalRows += countCursorCsvRows(csvText);
      if (accountId === store.activeAccountId) {
        activeAccountSynced = true;
      }
    } catch (error: unknown) {
      const failure = {
        accountId,
        message: error instanceof Error ? error.message : String(error),
        reason: toFailureReason(error),
      };
      errors.push(failure);
      if (accountId === store.activeAccountId) {
        activeAccountFailure = {
          message: failure.message,
          reason: failure.reason,
        };
      }
    }
  }

  if (successCount === 0 || !activeAccountSynced) {
    return {
      synced: false,
      rows: 0,
      error: activeAccountFailure?.message ?? errors[0]?.message ?? 'Cursor sync failed',
      reason: activeAccountFailure?.reason ?? errors[0]?.reason ?? 'unknown',
      activeAccountSynced,
    };
  }

  return {
    synced: true,
    rows: totalRows,
    error: errors.length > 0 ? `Some accounts failed to sync (${errors.length}/${Object.keys(store.accounts).length})` : undefined,
    reason: errors.length > 0 ? 'partial' : undefined,
    activeAccountSynced,
  };
}

// Avoid repeated network waits on automatic CLI runs, including failed syncs.
// Explicit Cursor selection and explicit TUI refresh continue to sync immediately.
function automaticSyncCacheKey(): string | null {
  try {
    const credentials = readFileSync(getCursorCredentialsPath(), 'utf8');
    const store = loadCursorCredentialsStore();
    if (!store || !existsSync(join(getCursorCacheDir(), 'usage.csv'))) return null;
    const files = Object.keys(store.accounts).map((id) => {
      const file = join(getCursorCacheDir(), id === store.activeAccountId
        ? 'usage.csv' : `usage.${sanitizeAccountIdForFilename(id)}.csv`);
      try {
        const stat = statSync(file, { bigint: true });
        return `${id}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      } catch {
        return `${id}:missing`;
      }
    });
    return createHash('sha256').update(JSON.stringify([credentials, files])).digest('hex');
  } catch {
    return null;
  }
}

export async function shouldSyncCursorForRun(config: {
  provider?: string;
  cursor: boolean;
  claude: boolean;
  codex: boolean;
  pi: boolean;
  openCode: boolean;
  allProviders: boolean;
}): Promise<{ attempted: boolean; error?: string }> {
  const hasProviderFilter = Boolean(
    config.provider ||
    config.cursor ||
    config.claude ||
    config.codex ||
    config.pi ||
    config.openCode,
  );
  const requestedCursor = config.cursor
    || (config.provider?.split(',').some((token) => {
      const normalized = token.trim().toLowerCase().replace(/\s+/g, '-');
      return normalized === 'cursor' || normalized === 'cursor-ide' || normalized === 'cursoride';
    }) ?? false);

  if (!isCursorLoggedIn()) {
    return { attempted: false };
  }

  if (!requestedCursor && hasProviderFilter && !config.allProviders) {
    return { attempted: false };
  }

  const configuredInterval = Number(process.env['TOKENLEAK_CURSOR_SYNC_INTERVAL_MS'] ?? 60_000);
  const interval = Number.isFinite(configuredInterval) && configuredInterval >= 0 ? configuredInterval : 60_000;
  const memoPath = join(getCursorCacheDir(), 'automatic-sync.json');
  if (!requestedCursor && interval > 0) {
    try {
      const memo = JSON.parse(readFileSync(memoPath, 'utf8'));
      const age = Date.now() - memo.completedAt;
      const key = automaticSyncCacheKey();
      if (key && memo.key === key && age >= 0 && age < interval &&
          (memo.error === undefined || typeof memo.error === 'string')) {
        return { attempted: false, error: memo.error };
      }
    } catch {
      // No reusable sync result; retry normally.
    }
  }

  const result = await syncCursorCache();
  try {
    const key = automaticSyncCacheKey();
    if (key && interval > 0) {
      atomicWriteFile(memoPath, JSON.stringify({ key, completedAt: Date.now(), error: result.error }),
        process.platform === 'win32' ? undefined : 0o600);
    }
  } catch {
    // Best effort: failures here must not affect usage or authentication.
  }
  return {
    attempted: true,
    error: result.error,
  };
}

export async function resolveCursorSetupStatus(
  options: { attemptSync?: boolean } = {},
): Promise<CursorSetupStatus> {
  const store = loadCursorCredentialsStore();
  const hasCredentials = Boolean(store && Object.keys(store.accounts).length > 0);
  const hasCache = hasCursorUsageCache();
  const activeMeta = getActiveAccountMeta(store);

  if (!hasCredentials) {
    return {
      state: hasCache ? 'ready' : 'needs_auth',
      hasCredentials,
      hasCache,
      ...activeMeta,
    };
  }

  if (!options.attemptSync) {
    return {
      state: hasCache ? 'ready' : 'needs_sync',
      hasCredentials,
      hasCache,
      ...activeMeta,
    };
  }

  const syncResult = await syncCursorCache();
  const nextHasCache = hasCursorUsageCache();

  if (syncResult.synced) {
    return {
      state: 'ready',
      hasCredentials,
      hasCache: nextHasCache,
      error: syncResult.error,
      reason: syncResult.reason,
      ...activeMeta,
    };
  }

  if (isCursorAuthFailureReason(syncResult.reason)) {
    return {
      state: 'needs_reauth',
      hasCredentials,
      hasCache: nextHasCache,
      error: syncResult.error,
      reason: syncResult.reason,
      ...activeMeta,
    };
  }

  return {
    state: nextHasCache ? 'sync_failed_cached' : 'needs_sync',
    hasCredentials,
    hasCache: nextHasCache,
    error: syncResult.error,
    reason: syncResult.reason,
    ...activeMeta,
  };
}
