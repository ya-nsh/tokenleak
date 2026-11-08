import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_SERVE_AGE_MS,
  REFRESH_AFTER_MS,
  REFRESH_LOCK_STALE_MS,
  REFRESH_TOKEN_ENV,
  SNAPSHOT_SWITCH_ENV,
  STATUSLINE_SNAPSHOT_VERSION,
  acquireRefreshLock,
  decideSnapshotUse,
  readStatuslineSnapshot,
  releaseRefreshLock,
  statuslineSnapshotKey,
  statuslineSnapshotPaths,
  writeStatuslineSnapshot,
} from './statusline-snapshot';
import type { StatuslineSnapshot } from './statusline-snapshot';

const NOW = Date.UTC(2026, 10, 30, 12);
const KEY = 'k'.repeat(64);

function snapshot(overrides: Partial<StatuslineSnapshot> = {}): StatuslineSnapshot {
  const completeness = { status: 'complete' as const, totalTokens: 10, pricedTokens: 10, unpricedTokens: 0, unknownModels: [] };
  return {
    version: STATUSLINE_SNAPSHOT_VERSION,
    key: KEY,
    today: '2026-11-30',
    computedAt: NOW,
    summary: {
      today: { tokens: 10, cost: 1.5, completeness },
      week: { tokens: 70, cost: 9, completeness },
      streak: 4,
    },
    ...overrides,
  };
}

describe('decideSnapshotUse', () => {
  test('computes when there is no snapshot', () => {
    expect(decideSnapshotUse(null, '2026-11-30', NOW)).toEqual({ kind: 'compute' });
  });

  test('serves a fresh snapshot without refreshing', () => {
    const stored = snapshot();
    expect(decideSnapshotUse(stored, '2026-11-30', NOW)).toEqual({ kind: 'serve', snapshot: stored, refresh: false });
    expect(decideSnapshotUse(stored, '2026-11-30', NOW + REFRESH_AFTER_MS - 1)).toMatchObject({ refresh: false });
  });

  test('serves a stale snapshot and asks for a refresh', () => {
    expect(decideSnapshotUse(snapshot(), '2026-11-30', NOW + REFRESH_AFTER_MS)).toMatchObject({ kind: 'serve', refresh: true });
    expect(decideSnapshotUse(snapshot(), '2026-11-30', NOW + MAX_SERVE_AGE_MS)).toMatchObject({ kind: 'serve', refresh: true });
  });

  test('computes once the snapshot is too old to serve', () => {
    expect(decideSnapshotUse(snapshot(), '2026-11-30', NOW + MAX_SERVE_AGE_MS + 1)).toEqual({ kind: 'compute' });
  });

  test('never serves another day as today, across a month boundary too', () => {
    expect(decideSnapshotUse(snapshot(), '2026-12-01', NOW + 1_000)).toEqual({ kind: 'compute' });
    expect(decideSnapshotUse(snapshot({ today: '2026-12-31' }), '2027-01-01', NOW)).toEqual({ kind: 'compute' });
  });

  test('computes when the snapshot claims to be from the future', () => {
    expect(decideSnapshotUse(snapshot(), '2026-11-30', NOW - 1)).toEqual({ kind: 'compute' });
  });
});

describe('statuslineSnapshotKey', () => {
  const selection = { provider: null, claude: false };

  test('is stable for the same selection and environment', () => {
    const env = { HOME: '/home/a', TOKENLEAK_GEMINI_DIR: '/g' };
    expect(statuslineSnapshotKey(selection, env)).toBe(statuslineSnapshotKey(selection, { ...env }));
    expect(statuslineSnapshotKey(selection, env)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('changes with the provider selection, data locations and time zone', () => {
    const base = statuslineSnapshotKey(selection, { HOME: '/home/a' });
    expect(statuslineSnapshotKey({ ...selection, claude: true }, { HOME: '/home/a' })).not.toBe(base);
    for (const env of [
      { HOME: '/home/b' },
      { HOME: '/home/a', CLAUDE_CONFIG_DIR: '/c' },
      { HOME: '/home/a', TOKENLEAK_CODEX_DIR: '/x' },
      { HOME: '/home/a', TZ: 'Asia/Kolkata' },
    ]) {
      expect(statuslineSnapshotKey(selection, env)).not.toBe(base);
    }
  });

  test('ignores unrelated variables and the refresh controls', () => {
    const base = statuslineSnapshotKey(selection, { HOME: '/home/a' });
    expect(
      statuslineSnapshotKey(selection, {
        HOME: '/home/a',
        PATH: '/bin',
        TERM: 'xterm',
        [REFRESH_TOKEN_ENV]: 'token',
        [SNAPSHOT_SWITCH_ENV]: '1',
      }),
    ).toBe(base);
  });
});

describe('snapshot files', () => {
  let dir: string;
  let paths: ReturnType<typeof statuslineSnapshotPaths>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tokenleak-statusline-'));
    paths = statuslineSnapshotPaths(join(dir, 'statusline'), KEY);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('writes privately and atomically, and reads back', () => {
    expect(writeStatuslineSnapshot(paths.snapshot, snapshot())).toBe(true);
    expect(readStatuslineSnapshot(paths.snapshot, KEY)).toEqual(snapshot());
    expect(statSync(paths.snapshot).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(dir, 'statusline'))).toEqual([`${KEY}.json`]);
  });

  test('reports a failed write and leaves no temp file', () => {
    writeFileSync(join(dir, 'blocker'), 'a file, not a directory');
    const blocked = statuslineSnapshotPaths(join(dir, 'blocker'), KEY);
    expect(writeStatuslineSnapshot(blocked.snapshot, snapshot())).toBe(false);
    expect(readdirSync(dir)).toEqual(['blocker']);
  });

  test('reads a missing, corrupt, foreign or malformed snapshot as null', () => {
    expect(readStatuslineSnapshot(paths.snapshot, KEY)).toBeNull();
    const variants: unknown[] = [
      'not json',
      { ...snapshot(), version: STATUSLINE_SNAPSHOT_VERSION + 1 },
      { ...snapshot(), key: 'other' },
      { ...snapshot(), today: 20261130 },
      { ...snapshot(), computedAt: -1 },
      { ...snapshot(), summary: { ...snapshot().summary, streak: 1.5 } },
      { ...snapshot(), summary: { ...snapshot().summary, today: { tokens: 1, cost: 1 } } },
      {
        ...snapshot(),
        summary: {
          ...snapshot().summary,
          week: { tokens: 1, cost: 1, completeness: { ...snapshot().summary.week.completeness, status: 'odd' } },
        },
      },
      [snapshot()],
    ];
    writeStatuslineSnapshot(paths.snapshot, snapshot());
    for (const variant of variants) {
      writeFileSync(paths.snapshot, typeof variant === 'string' ? variant : JSON.stringify(variant));
      expect(readStatuslineSnapshot(paths.snapshot, KEY)).toBeNull();
    }
  });

  test('one refresh lock at a time, released only by its owner', () => {
    expect(acquireRefreshLock(paths.lock, 'first', Date.now())).toBe(true);
    expect(acquireRefreshLock(paths.lock, 'second', Date.now())).toBe(false);
    releaseRefreshLock(paths.lock, 'second');
    expect(readFileSync(paths.lock, 'utf8')).toBe('first');
    releaseRefreshLock(paths.lock, 'first');
    expect(existsSync(paths.lock)).toBe(false);
    expect(acquireRefreshLock(paths.lock, 'third', Date.now())).toBe(true);
  });

  test('takes over a lock abandoned for longer than the stale limit', () => {
    expect(acquireRefreshLock(paths.lock, 'crashed', Date.now())).toBe(true);
    const old = new Date(Date.now() - REFRESH_LOCK_STALE_MS - 60_000);
    utimesSync(paths.lock, old, old);
    expect(acquireRefreshLock(paths.lock, 'next', Date.now())).toBe(true);
    expect(readFileSync(paths.lock, 'utf8')).toBe('next');
  });

  test('cannot lock in an unwritable place, and releasing a missing lock is harmless', () => {
    writeFileSync(join(dir, 'blocker'), 'x');
    expect(acquireRefreshLock(join(dir, 'blocker', 'a.lock'), 'token', Date.now())).toBe(false);
    expect(() => releaseRefreshLock(paths.lock, 'token')).not.toThrow();
  });
});
