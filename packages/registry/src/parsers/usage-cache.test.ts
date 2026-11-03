import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { UsageFileCache } from './usage-cache';
import { parseAppendableJsonl } from './appendable-jsonl';
import type { AppendableParser } from './usage-cache';

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
const create = (version = 'test-v1') =>
  new UsageFileCache<{ text: string }>(
    version,
    dir,
    (value) =>
      value !== null &&
      typeof value === 'object' &&
      'text' in value &&
      typeof value.text === 'string',
  );
const parse = async () => {
  calls++;
  return {
    records: [{ text: readFileSync(file, 'utf8') }],
    warnings: [{ kind: 'parse' as const, file, line: 2 }],
  };
};
function storedFiles(): string[] {
  const db = new Database(join(dir, 'cache', 'usage.sqlite'));
  try {
    return (db.query('SELECT file FROM entries ORDER BY file').values() as [string][]).map(([name]) => name);
  } finally {
    db.close();
  }
}
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
    expect(statSync(join(dir, 'cache', 'usage.sqlite')).mode & 0o777).toBe(0o600);
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
    writeFileSync(join(dir, 'cache', 'usage.sqlite'), 'not a database');
    for (const suffix of ['-wal', '-shm']) rmSync(join(dir, 'cache', `usage.sqlite${suffix}`), { force: true });
    await load();
    expect(calls).toBe(2);
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
    expect(storedFiles()).toEqual([]);
  });
  test('disable switch bypasses existing entries', async () => {
    await load();
    process.env['TOKENLEAK_USAGE_CACHE'] = '0';
    await load();
    await load();
    expect(calls).toBe(3);
  });
});

interface Line {
  n: number;
  seen: number;
}
interface Counter {
  seen: number;
}
const isCounter = (value: unknown): value is Counter =>
  typeof value === 'object' && value !== null && typeof (value as Counter).seen === 'number';
const appendable = (starts: (number | null)[]): AppendableParser<Line, Counter> => ({
  isState: isCounter,
  parse: (from) => {
    starts.push(from?.offset ?? null);
    return parseAppendableJsonl<Line, Counter>(file, from, {
      initialState: () => ({ seen: 0 }),
      cloneState: (state) => ({ ...state }),
      visit: (record, state, records) => {
        state.seen += 1;
        records.push({ n: (record as { n: number }).n, seen: state.seen });
      },
    });
  },
});
const createLines = () =>
  new UsageFileCache<Line>('lines-v1', dir, (value) => typeof value === 'object' && value !== null);
async function loadLines(starts: (number | null)[]) {
  const cache = createLines();
  const result = await cache.readAppendable(file, appendable(starts));
  await cache.save();
  return result;
}
async function uncachedLines() {
  process.env['TOKENLEAK_USAGE_CACHE'] = '0';
  try {
    return await createLines().readAppendable(file, appendable([]));
  } finally {
    delete process.env['TOKENLEAK_USAGE_CACHE'];
  }
}
const line = (n: number) => `${JSON.stringify({ n })}\n`;

describe('UsageFileCache.readAppendable', () => {
  test('parses only appended lines and carries parser state across runs', async () => {
    writeFileSync(file, line(1) + line(2));
    const starts: (number | null)[] = [];
    await loadLines(starts);
    appendFileSync(file, line(3));
    const resumed = await loadLines(starts);
    expect(starts).toEqual([null, line(1).length * 2]);
    expect(resumed.records).toEqual([
      { n: 1, seen: 1 },
      { n: 2, seen: 2 },
      { n: 3, seen: 3 },
    ]);
    expect(resumed).toEqual(await uncachedLines());
    await loadLines(starts);
    expect(starts).toHaveLength(2);
  });

  test('rereads an unterminated last line once it is complete', async () => {
    writeFileSync(file, line(1) + '{"n":');
    const starts: (number | null)[] = [];
    const partial = await loadLines(starts);
    expect(partial.records).toEqual([{ n: 1, seen: 1 }]);
    expect(partial.warnings.map((warning) => warning.line)).toEqual([2]);
    appendFileSync(file, '2}\n' + line(3));
    const completed = await loadLines(starts);
    expect(starts).toEqual([null, line(1).length]);
    expect(completed.records).toEqual([
      { n: 1, seen: 1 },
      { n: 2, seen: 2 },
      { n: 3, seen: 3 },
    ]);
    expect(completed.warnings).toEqual([]);
    expect(completed).toEqual(await uncachedLines());
  });

  test('keeps a complete record on an unterminated last line', async () => {
    writeFileSync(file, line(1) + JSON.stringify({ n: 2 }));
    const result = await loadLines([]);
    expect(result.records).toEqual([
      { n: 1, seen: 1 },
      { n: 2, seen: 2 },
    ]);
    expect(await loadLines([])).toEqual(result);
  });

  test('reparses from the start when earlier bytes change or the file shrinks', async () => {
    writeFileSync(file, line(1) + line(2));
    const starts: (number | null)[] = [];
    await loadLines(starts);
    writeFileSync(file, line(7) + line(2) + line(3));
    expect((await loadLines(starts)).records.map((record) => record.n)).toEqual([7, 2, 3]);
    writeFileSync(file, line(4));
    expect((await loadLines(starts)).records.map((record) => record.n)).toEqual([4]);
    expect(starts).toEqual([null, null, null]);
  });

  test('reparses from the start when the file is replaced by a new inode', async () => {
    writeFileSync(file, line(1));
    const starts: (number | null)[] = [];
    await loadLines(starts);
    rmSync(file);
    writeFileSync(file, line(1) + line(2));
    expect((await loadLines(starts)).records.map((record) => record.n)).toEqual([1, 2]);
    expect(starts).toEqual([null, null]);
  });

  test('ignores resume data whose parser state no longer validates', async () => {
    writeFileSync(file, line(1));
    const starts: (number | null)[] = [];
    await loadLines(starts);
    const db = new Database(join(dir, 'cache', 'usage.sqlite'));
    const { resume } = db.query('SELECT resume FROM entries').get() as { resume: string };
    db.query('UPDATE entries SET resume = ?').run(JSON.stringify({ ...JSON.parse(resume), state: { seen: 'x' } }));
    db.close();
    appendFileSync(file, line(2));
    expect((await loadLines(starts)).records.map((record) => record.seen)).toEqual([1, 2]);
    expect(starts).toEqual([null, null]);
  });

  test('does not persist a file that grows during parsing', async () => {
    writeFileSync(file, line(1));
    const cache = createLines();
    const parser = appendable([]);
    await cache.readAppendable(file, {
      isState: parser.isState,
      parse: async (from) => {
        const result = await parser.parse(from);
        appendFileSync(file, line(2));
        return result;
      },
    });
    await cache.save();
    expect(storedFiles()).toEqual([]);
  });
});
