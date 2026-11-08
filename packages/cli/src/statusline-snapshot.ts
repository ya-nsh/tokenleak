/**
 * A cached status line, served at once and refreshed in the background.
 *
 * Status bars run `tokenleak statusline` on every prompt, and computing it
 * loads 60 days of usage from every provider. Instead, the last computed
 * summary is printed immediately, and when it is a few seconds old a detached
 * process recomputes it for the next call (stale-while-revalidate). The line
 * is therefore at most one refresh behind, and never shows yesterday's spend
 * as today's: a summary from another day, or one too old, is recomputed in
 * the foreground.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import type { CostCompleteness } from '@tokenleak/core';
import type { StatuslineSummary } from './statusline.js';

/** Bumped when the stored layout changes; other versions' snapshots are ignored. */
export const STATUSLINE_SNAPSHOT_VERSION = 1;
/** A snapshot younger than this is served without starting a refresh. */
export const REFRESH_AFTER_MS = 5_000;
/** A snapshot older than this is not served; the line is computed in the foreground. */
export const MAX_SERVE_AGE_MS = 10 * 60 * 1_000;
/**
 * A refresh lock older than this is treated as abandoned. A refresh that
 * fails leaves its lock behind, so this is also the retry delay after a failure.
 */
export const REFRESH_LOCK_STALE_MS = 2 * 60 * 1_000;
/** Set in a background refresh's environment to the lock token it owns. */
export const REFRESH_TOKEN_ENV = 'TOKENLEAK_STATUSLINE_REFRESH_TOKEN';
/** `0` turns the snapshot off: every call computes the line in the foreground. */
export const SNAPSHOT_SWITCH_ENV = 'TOKENLEAK_STATUSLINE_CACHE';

const PRIVATE_FILE_MODE = 0o600;
/** Variables, besides `TOKENLEAK_*`, that change which logs are read or how days are bucketed. */
const DATA_LOCATION_ENV = [
  'HOME',
  'TZ',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'PI_CODING_AGENT_DIR',
  'HERMES_HOME',
];

export interface StatuslineSnapshot {
  version: typeof STATUSLINE_SNAPSHOT_VERSION;
  /** Identifies the provider selection and data locations the summary was computed for. */
  key: string;
  /** The local date the summary's "today" refers to. */
  today: string;
  /** When the summary was computed, in epoch milliseconds. */
  computedAt: number;
  summary: StatuslineSummary;
}

export type SnapshotDecision =
  | { kind: 'serve'; snapshot: StatuslineSnapshot; refresh: boolean }
  | { kind: 'compute' };

/**
 * Whether a stored snapshot can answer now. A snapshot from another day, from
 * the future (the clock moved back), or older than {@link MAX_SERVE_AGE_MS}
 * is recomputed in the foreground.
 */
export function decideSnapshotUse(snapshot: StatuslineSnapshot | null, today: string, now: number): SnapshotDecision {
  if (!snapshot || snapshot.today !== today) return { kind: 'compute' };
  const age = now - snapshot.computedAt;
  if (age < 0 || age > MAX_SERVE_AGE_MS) return { kind: 'compute' };
  return { kind: 'serve', snapshot, refresh: age >= REFRESH_AFTER_MS };
}

/**
 * The snapshot identity: the provider selection plus every environment
 * variable that moves log locations or the time zone. The refresh-control
 * variables themselves are left out.
 */
export function statuslineSnapshotKey(selection: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const relevant = Object.keys(env)
    .filter(
      (name) =>
        (name.startsWith('TOKENLEAK_') && name !== REFRESH_TOKEN_ENV && name !== SNAPSHOT_SWITCH_ENV) ||
        DATA_LOCATION_ENV.includes(name),
    )
    .sort()
    .map((name) => [name, env[name]]);
  return createHash('sha256').update(JSON.stringify([selection, relevant])).digest('hex');
}

export interface SnapshotPaths {
  snapshot: string;
  lock: string;
}

export function statuslineSnapshotPaths(directory: string, key: string): SnapshotPaths {
  return { snapshot: join(directory, `${key}.json`), lock: join(directory, `${key}.lock`) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCompleteness(value: unknown): value is CostCompleteness {
  return (
    isRecord(value) &&
    (value['status'] === 'complete' || value['status'] === 'partial' || value['status'] === 'unknown') &&
    isCount(value['totalTokens']) &&
    isCount(value['pricedTokens']) &&
    isCount(value['unpricedTokens']) &&
    Array.isArray(value['unknownModels']) &&
    value['unknownModels'].every((model) => typeof model === 'string') &&
    (value['hasKnownCostOnly'] === undefined || typeof value['hasKnownCostOnly'] === 'boolean')
  );
}

function isPeriod(value: unknown): boolean {
  return isRecord(value) && isCount(value['tokens']) && isCount(value['cost']) && isCompleteness(value['completeness']);
}

function isSummary(value: unknown): value is StatuslineSummary {
  return (
    isRecord(value) &&
    isPeriod(value['today']) &&
    isPeriod(value['week']) &&
    Number.isInteger(value['streak']) &&
    isCount(value['streak'])
  );
}

/** Read and validate a stored snapshot. Anything missing, foreign or malformed reads as `null`. */
export function readStatuslineSnapshot(path: string, key: string): StatuslineSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (
    isRecord(value) &&
    value['version'] === STATUSLINE_SNAPSHOT_VERSION &&
    value['key'] === key &&
    typeof value['today'] === 'string' &&
    isCount(value['computedAt']) &&
    isSummary(value['summary'])
  ) {
    return value as unknown as StatuslineSnapshot;
  }
  return null;
}

/**
 * Store a snapshot atomically (temp file, then rename), so a reader never sees
 * a partial file. Returns false if it could not be written; a missing snapshot
 * only costs the next call a foreground computation.
 */
export function writeStatuslineSnapshot(path: string, snapshot: StatuslineSnapshot): boolean {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(temp, JSON.stringify(snapshot), { mode: PRIVATE_FILE_MODE });
    chmodSync(temp, PRIVATE_FILE_MODE);
    renameSync(temp, path);
    return true;
  } catch {
    removeQuietly(temp);
    return false;
  }
}

/** Best-effort delete; the path may be gone, or its directory may not even exist. */
function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Nothing left to clean up.
  }
}

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error['code'] : undefined;
}

function tryCreateLock(path: string, token: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'wx', PRIVATE_FILE_MODE);
  } catch (error: unknown) {
    if (errorCode(error) === 'EEXIST') return false;
    throw error;
  }
  try {
    writeSync(fd, token);
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Claim the right to start a refresh. Only one refresh per snapshot runs at a
 * time; a lock older than {@link REFRESH_LOCK_STALE_MS} is taken over.
 */
export function acquireRefreshLock(path: string, token: string, now: number): boolean {
  try {
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 });
    if (tryCreateLock(path, token)) return true;
    if (now - statSync(path).mtimeMs <= REFRESH_LOCK_STALE_MS) return false;
    rmSync(path, { force: true });
    return tryCreateLock(path, token);
  } catch {
    return false;
  }
}

/** Remove the lock, but only if `token` still owns it. */
export function releaseRefreshLock(path: string, token: string): void {
  try {
    if (readFileSync(path, 'utf8') === token) rmSync(path, { force: true });
  } catch {
    // Already gone, or taken over after going stale.
  }
}

export function newRefreshToken(): string {
  return randomUUID();
}
