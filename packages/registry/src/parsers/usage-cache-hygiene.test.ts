import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { UsageFileCache, pruneRetiredJsonCaches } from './usage-cache';

const HEX = 'a'.repeat(64);
const OTHER_HEX = 'b'.repeat(64);
const DAY_MS = 24 * 60 * 60 * 1_000;

let dir: string;
let cacheDir: string;
const originalDir = process.env['TOKENLEAK_USAGE_CACHE_DIR'];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tokenleak-cache-hygiene-'));
  cacheDir = join(dir, 'cache');
  mkdirSync(cacheDir);
  process.env['TOKENLEAK_USAGE_CACHE_DIR'] = cacheDir;
});

afterEach(() => {
  if (originalDir === undefined) delete process.env['TOKENLEAK_USAGE_CACHE_DIR'];
  else process.env['TOKENLEAK_USAGE_CACHE_DIR'] = originalDir;
  rmSync(dir, { recursive: true, force: true });
});

function touch(name: string, ageMs: number): void {
  const path = join(cacheDir, name);
  writeFileSync(path, '{}');
  const time = new Date(Date.now() - ageMs);
  utimesSync(path, time, time);
}

describe('pruneRetiredJsonCaches', () => {
  test('removes every pre-SQLite JSON cache and old temp files', () => {
    touch(`claude-code-v6-${HEX}.json`, 0);
    touch(`codex-v4-${OTHER_HEX}.json`, 0);
    touch(`${OTHER_HEX}.json`, 0);
    touch(`claude-code-v6-${HEX}.json.1234.tmp`, 2 * 60 * 60 * 1_000);

    const removed = pruneRetiredJsonCaches(cacheDir).sort();

    expect(removed).toEqual(
      [
        `${OTHER_HEX}.json`,
        `claude-code-v6-${HEX}.json`,
        `claude-code-v6-${HEX}.json.1234.tmp`,
        `codex-v4-${OTHER_HEX}.json`,
      ].sort(),
    );
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  test('keeps the store, recent temps and unrelated files', () => {
    touch('usage.sqlite', 0);
    touch(`claude-code-v6-${HEX}.json.99.tmp`, 60_000);
    touch('notes.json', 0);

    expect(pruneRetiredJsonCaches(cacheDir)).toEqual([]);
  });

  test('a missing directory is a no-op', () => {
    expect(pruneRetiredJsonCaches(join(dir, 'nope'))).toEqual([]);
  });
});

describe('store pruning', () => {
  const valid = (value: unknown) => typeof value === 'object' && value !== null;
  const cacheKeys = (): string[] => {
    const db = new Database(join(cacheDir, 'usage.sqlite'));
    try {
      return (db.query('SELECT family || \'@\' || version FROM caches ORDER BY 1').values() as [string][]).map(
        ([key]) => key,
      );
    } finally {
      db.close();
    }
  };
  const fill = async (namespace: string, root: string) => {
    const source = join(dir, 'session.jsonl');
    writeFileSync(source, 'x');
    const cache = new UsageFileCache<object>(namespace, root, valid);
    await cache.read(source, async () => ({ records: [{}], warnings: [] }));
    await cache.save();
  };

  test('drops other parser versions of the same provider but keeps other providers', async () => {
    await fill('claude-code-v1', dir);
    await fill('codex-v1', dir);
    await fill('claude-code-v2', dir);
    expect(cacheKeys()).toEqual(['claude-code@2', 'codex@1']);
  });

  test('drops roots of the same provider unused for 30 days', async () => {
    await fill('claude-code-v1', join(dir, 'old-root'));
    const db = new Database(join(cacheDir, 'usage.sqlite'));
    db.query('UPDATE caches SET last_used = ?').run(Date.now() - 31 * DAY_MS);
    db.close();
    await fill('claude-code-v1', join(dir, 'new-root'));
    const check = new Database(join(cacheDir, 'usage.sqlite'));
    const roots = (check.query('SELECT COUNT(*) AS n FROM caches').get() as { n: number }).n;
    const entries = (check.query('SELECT COUNT(*) AS n FROM entries').get() as { n: number }).n;
    check.close();
    expect(roots).toBe(1);
    expect(entries).toBe(1);
  });
});

describe('prompt packing', () => {
  test('stores each prompt once and restores it on read', async () => {
    const source = join(dir, 'session.jsonl');
    writeFileSync(source, 'x');
    const prompt = 'refactor the parser '.repeat(50);
    const records = Array.from({ length: 30 }, (_, i) => ({ id: i, prompt, promptId: 'user:1' }));
    const valid = (value: unknown) => typeof value === 'object' && value !== null;

    const writer = new UsageFileCache<{ id: number; prompt?: string; promptId?: string }>('test-v1', dir, valid);
    await writer.read(source, async () => ({ records, warnings: [] }));
    await writer.save();

    const db = new Database(join(cacheDir, 'usage.sqlite'));
    const { payload: raw } = db.query('SELECT payload FROM entries').get() as { payload: string };
    db.close();
    expect(raw.split('refactor the parser').length - 1).toBe(50);

    const reader = new UsageFileCache<{ id: number; prompt?: string; promptId?: string }>('test-v1', dir, valid);
    let parsed = false;
    const result = await reader.read(source, async () => {
      parsed = true;
      return { records: [], warnings: [] };
    });
    expect(parsed).toBe(false);
    expect(result.records).toHaveLength(30);
    expect(result.records.every((record) => record.prompt === prompt)).toBe(true);
  });

  test('records whose prompts disagree under one id keep their own text', async () => {
    const source = join(dir, 'session.jsonl');
    writeFileSync(source, 'x');
    const valid = (value: unknown) => typeof value === 'object' && value !== null;
    const writer = new UsageFileCache<{ prompt?: string; promptId?: string }>('test-v1', dir, valid);
    await writer.read(source, async () => ({
      records: [
        { prompt: 'a', promptId: 'p' },
        { prompt: 'b', promptId: 'p' },
        { prompt: 'no id' },
      ],
      warnings: [],
    }));
    await writer.save();
    const reader = new UsageFileCache<{ prompt?: string; promptId?: string }>('test-v1', dir, valid);
    const result = await reader.read(source, async () => ({ records: [], warnings: [] }));
    expect(result.records.map((record) => record.prompt)).toEqual(['a', 'b', 'no id']);
  });
});
