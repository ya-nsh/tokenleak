import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageFileCache } from './usage-cache';

let dir: string;
let file: string;
let calls: number;
const originalDir = process.env['TOKENLEAK_USAGE_CACHE_DIR'];
const originalEnabled = process.env['TOKENLEAK_USAGE_CACHE'];
const originalLimit = process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'];
const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tokenleak-usage-cache-'));
  file = join(dir, 'session.jsonl');
  writeFileSync(file, 'first');
  calls = 0;
  process.env['TOKENLEAK_USAGE_CACHE_DIR'] = join(dir, 'cache');
  delete process.env['TOKENLEAK_USAGE_CACHE'];
});
afterEach(() => {
  restore('TOKENLEAK_USAGE_CACHE_DIR', originalDir);
  restore('TOKENLEAK_USAGE_CACHE', originalEnabled);
  restore('TOKENLEAK_MAX_JSONL_RECORD_BYTES', originalLimit);
  rmSync(dir, { recursive: true, force: true });
});
const create = (version = 'test-v1') => new UsageFileCache<{ text: string }>(version, dir);
const parse = async () => {
  calls++;
  return {
    records: [{ text: readFileSync(file, 'utf8') }],
    warnings: [{ kind: 'parse' as const, file, line: 2 }],
  };
};
async function load() {
  const cache = create();
  const result = await cache.read(file, parse);
  await cache.save();
  return result;
}

describe('UsageFileCache', () => {
  test('persists extracted records and warnings across instances with private permissions', async () => {
    const first = await load();
    expect(await load()).toEqual(first);
    expect(calls).toBe(1);
    const cacheFile = join(dir, 'cache', readdirSync(join(dir, 'cache'))[0]!);
    expect(statSync(cacheFile).mode & 0o777).toBe(0o600);
  });
  test('invalidates appends, truncation and replacement even with restored mtime', async () => {
    await load();
    appendFileSync(file, ' appended');
    expect((await load()).records[0]!.text).toBe('first appended');
    const old = statSync(file);
    rmSync(file);
    writeFileSync(file, 'other content!');
    utimesSync(file, old.atime, old.mtime);
    expect((await load()).records[0]!.text).toBe('other content!');
    writeFileSync(file, '');
    expect((await load()).records[0]!.text).toBe('');
    expect(calls).toBe(4);
  });
  test('does not persist a file that changes during parsing', async () => {
    const cache = create();
    await cache.read(file, async () => {
      const result = await parse();
      appendFileSync(file, ' changed');
      return result;
    });
    await cache.save();
    expect((await load()).records[0]!.text).toBe('first changed');
    expect(calls).toBe(2);
  });
  test('rebuilds corrupt cache and tolerates an unwritable cache location', async () => {
    await load();
    const cacheFile = join(dir, 'cache', readdirSync(join(dir, 'cache'))[0]!);
    writeFileSync(cacheFile, '{broken');
    await load();
    expect(calls).toBe(2);
    process.env['TOKENLEAK_USAGE_CACHE_DIR'] = file;
    expect((await load()).records[0]!.text).toBe('first');
  });
  test('parser version and maximum record size invalidate cached parsing', async () => {
    await load();
    await create('test-v2').read(file, parse);
    process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'] = '12';
    await load();
    expect(calls).toBe(3);
  });
  test('removes deleted files and never hides source read errors', async () => {
    await load();
    rmSync(file);
    await expect(create().read(file, parse)).rejects.toThrow();
    await create().save();
    const path = join(dir, 'cache', readdirSync(join(dir, 'cache'))[0]!);
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toEqual({});
  });
  test('disable switch bypasses existing entries', async () => {
    await load();
    process.env['TOKENLEAK_USAGE_CACHE'] = '0';
    await load();
    await load();
    expect(calls).toBe(3);
  });
});
