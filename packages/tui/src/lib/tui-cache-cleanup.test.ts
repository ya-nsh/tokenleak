import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SUPERSEDED_CACHE_MAX_IDLE_MS } from '@tokenleak/core';
import { removeSupersededTuiCaches } from './data';

const MINUTE_MS = 60_000;
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tokenleak-tui-cache-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes `name` with a last write `ageMs` before NOW. */
function write(name: string, ageMs: number): void {
  const path = join(dir, name);
  writeFileSync(path, '{}');
  const time = new Date(NOW - ageMs);
  utimesSync(path, time, time);
}

const IDLE = SUPERSEDED_CACHE_MAX_IDLE_MS + MINUTE_MS;

describe('removeSupersededTuiCaches', () => {
  test('removes snapshots of other versions idle for over a week and keeps everything else', () => {
    for (const name of ['tui-data-v1.json', 'tui-data-v2.json', 'pricing.json', 'tui-data-v3.json.tmp-1']) write(name, IDLE);
    write('tui-data-v3.json', 0);
    const removed = removeSupersededTuiCaches(join(dir, 'tui-data-v3.json'), NOW).sort();
    expect(removed).toEqual(['tui-data-v1.json', 'tui-data-v2.json']);
    expect(readdirSync(dir).sort()).toEqual(['pricing.json', 'tui-data-v3.json', 'tui-data-v3.json.tmp-1']);
  });

  test('keeps a snapshot another installed version wrote recently', () => {
    write('tui-data-v3.json', 30 * MINUTE_MS);
    write('tui-data-v4.json', 0);
    expect(removeSupersededTuiCaches(join(dir, 'tui-data-v4.json'), NOW)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['tui-data-v3.json', 'tui-data-v4.json']);
  });

  test('a snapshot exactly at the idle limit is kept; one just past it goes', () => {
    write('tui-data-v2.json', SUPERSEDED_CACHE_MAX_IDLE_MS);
    write('tui-data-v3.json', SUPERSEDED_CACHE_MAX_IDLE_MS + 1);
    expect(removeSupersededTuiCaches(join(dir, 'tui-data-v4.json'), NOW)).toEqual(['tui-data-v3.json']);
  });

  test('never removes the current snapshot, however old', () => {
    write('tui-data-v4.json', 10 * IDLE);
    expect(removeSupersededTuiCaches(join(dir, 'tui-data-v4.json'), NOW)).toEqual([]);
  });

  test('a missing directory is a no-op', () => {
    expect(removeSupersededTuiCaches(join(tmpdir(), 'tokenleak-missing-dir', 'tui-data-v3.json'), NOW)).toEqual([]);
  });
});
