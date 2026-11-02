import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeSupersededTuiCaches } from './data';

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('removeSupersededTuiCaches', () => {
  test('removes older snapshot versions and keeps everything else', () => {
    dir = mkdtempSync(join(tmpdir(), 'tokenleak-tui-cache-'));
    for (const name of ['tui-data-v1.json', 'tui-data-v2.json', 'tui-data-v3.json', 'pricing.json', 'tui-data-v3.json.tmp-1']) {
      writeFileSync(join(dir, name), '{}');
    }
    const removed = removeSupersededTuiCaches(join(dir, 'tui-data-v3.json')).sort();
    expect(removed).toEqual(['tui-data-v1.json', 'tui-data-v2.json']);
    expect(readdirSync(dir).sort()).toEqual(['pricing.json', 'tui-data-v3.json', 'tui-data-v3.json.tmp-1']);
  });

  test('a missing directory is a no-op', () => {
    expect(removeSupersededTuiCaches(join(tmpdir(), 'tokenleak-missing-dir', 'tui-data-v3.json'))).toEqual([]);
  });
});
