import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageFileCache, pruneUsageCacheDirectory } from './usage-cache';

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

describe('pruneUsageCacheDirectory', () => {
  const keep = { family: 'claude-code', version: '6', fileName: `claude-code-v6-${HEX}.json` };

  test('removes other versions, legacy files, old temps, and long-unused roots', () => {
    touch(keep.fileName, 0);
    touch(`claude-code-v5-${HEX}.json`, 0);
    touch(`claude-code-v4-${OTHER_HEX}.json`, 0);
    touch(`${OTHER_HEX}.json`, 0);
    touch(`claude-code-v6-${HEX}.json.1234.tmp`, 2 * 60 * 60 * 1_000);
    touch(`claude-code-v6-${OTHER_HEX}.json`, 40 * DAY_MS);

    const removed = pruneUsageCacheDirectory(cacheDir, keep).sort();

    expect(removed).toEqual(
      [
        `${OTHER_HEX}.json`,
        `claude-code-v4-${OTHER_HEX}.json`,
        `claude-code-v5-${HEX}.json`,
        `claude-code-v6-${HEX}.json.1234.tmp`,
        `claude-code-v6-${OTHER_HEX}.json`,
      ].sort(),
    );
    expect(readdirSync(cacheDir)).toEqual([keep.fileName]);
  });

  test('keeps other families, recent temps, and recently used roots', () => {
    touch(`codex-v4-${HEX}.json`, 0);
    touch(`claude-code-v6-${OTHER_HEX}.json`, 2 * DAY_MS);
    touch(`claude-code-v6-${HEX}.json.99.tmp`, 60_000);
    touch(`claude-code-vision-v1-${HEX}.json`, 0);

    expect(pruneUsageCacheDirectory(cacheDir, keep)).toEqual([]);
  });

  test('a missing directory is a no-op', () => {
    expect(pruneUsageCacheDirectory(join(dir, 'nope'), keep)).toEqual([]);
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

    const file = readdirSync(cacheDir).find((name) => name.startsWith('test-v1-'))!;
    const raw = readFileSync(join(cacheDir, file), 'utf8');
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
