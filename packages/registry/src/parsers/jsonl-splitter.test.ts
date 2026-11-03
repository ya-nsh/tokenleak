import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { scanJsonlLines, splitJsonlRecords } from './jsonl-splitter';
import type { JsonlLine } from './jsonl-splitter';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__');

async function collectAll(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const results: unknown[] = [];
  for await (const record of gen) {
    results.push(record);
  }
  return results;
}

describe('splitJsonlRecords', () => {
  test('valid JSONL yields all records', async () => {
    const records = await collectAll(
      splitJsonlRecords(join(FIXTURES_DIR, 'valid.jsonl')),
    );

    expect(records).toHaveLength(5);
    expect(records[0]).toEqual({
      id: 1,
      model: 'claude-3-opus',
      tokens: 1500,
      cost: 0.045,
    });
    expect(records[4]).toEqual({
      id: 5,
      model: 'gpt-3.5-turbo',
      tokens: 300,
      cost: 0.0006,
    });
  });

  test('empty file yields nothing', async () => {
    const records = await collectAll(
      splitJsonlRecords(join(FIXTURES_DIR, 'empty.jsonl')),
    );

    expect(records).toHaveLength(0);
  });

  test('blank lines are skipped', async () => {
    const records = await collectAll(
      splitJsonlRecords(join(FIXTURES_DIR, 'blank-lines.jsonl')),
    );

    expect(records).toHaveLength(3);
    expect(records[0]).toEqual({
      id: 1,
      model: 'claude-3-opus',
      tokens: 1500,
    });
    expect(records[2]).toEqual({
      id: 3,
      model: 'gpt-4',
      tokens: 2000,
    });
  });

  test('malformed JSON lines are skipped', async () => {
    const filePath = join(FIXTURES_DIR, 'malformed.jsonl');
    // malformed.jsonl has valid JSON on line 1 and bad JSON on line 2
    const records = await collectAll(splitJsonlRecords(filePath));
    // Only the valid records should be yielded, bad ones are skipped
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ id: 1, model: 'claude-3-opus', tokens: 1500 });
    expect(records[1]).toEqual({ id: 3, model: 'gpt-4', tokens: 2000 });
  });

  test('oversized records are skipped', async () => {
    const tmpPath = join(FIXTURES_DIR, '_oversized_temp.jsonl');
    const smallRecord = JSON.stringify({ id: 1 });
    const largeRecord = JSON.stringify({ data: 'x'.repeat(100) });
    await Bun.write(tmpPath, `${smallRecord}\n${largeRecord}\n`);

    const originalEnv = process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'];
    try {
      process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'] = '50';

      const warnings: string[] = [];
      const records = await collectAll(splitJsonlRecords(tmpPath));
      for await (const record of splitJsonlRecords(tmpPath, {
        onWarning: (warning) => warnings.push(`${warning.kind}:${warning.line}`),
      })) {
        void record;
      }
      // Only the small record should be yielded, oversized one is skipped
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ id: 1 });
      expect(warnings).toEqual(['oversize:2']);
    } finally {
      if (originalEnv === undefined) {
        delete process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'];
      } else {
        process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'] = originalEnv;
      }
      const { unlinkSync } = await import('node:fs');
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  test('single record file works', async () => {
    const tmpPath = join(FIXTURES_DIR, '_single_temp.jsonl');
    await Bun.write(tmpPath, JSON.stringify({ only: true }) + '\n');

    try {
      const records = await collectAll(splitJsonlRecords(tmpPath));
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual({ only: true });
    } finally {
      const { unlinkSync } = await import('node:fs');
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  test('malformed lines emit parse warnings', async () => {
    const warnings: string[] = [];
    const filePath = join(FIXTURES_DIR, 'malformed.jsonl');

    const records = await collectAll(splitJsonlRecords(filePath, {
      onWarning: (warning) => warnings.push(`${warning.kind}:${warning.line}`),
    }));

    expect(records).toHaveLength(2);
    expect(warnings).toEqual(['parse:2']);
  });
});

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

function withTempFile(content: string | Buffer, run: (path: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'tokenleak-jsonl-'));
  const path = join(dir, 'records.jsonl');
  writeFileSync(path, content);
  return run(path).finally(() => rmSync(dir, { recursive: true, force: true }));
}

async function scanAll(path: string, start?: number, lineNumber?: number): Promise<JsonlLine[]> {
  const lines: JsonlLine[] = [];
  for await (const line of scanJsonlLines(path, { start, lineNumber })) lines.push(line);
  return lines;
}

describe('splitJsonlRecords line breaks', () => {
  test('keeps records whose strings contain U+2028 or U+2029', async () => {
    const text = `before${LINE_SEPARATOR}middle${PARAGRAPH_SEPARATOR}after`;
    await withTempFile(`${JSON.stringify({ text })}\n${JSON.stringify({ id: 2 })}\n`, async (path) => {
      const warnings: string[] = [];
      const records = await collectAll(
        splitJsonlRecords(path, { onWarning: (warning) => warnings.push(`${warning.kind}:${warning.line}`) }),
      );
      expect(records).toEqual([{ text }, { id: 2 }]);
      expect(warnings).toEqual([]);
    });
  });

  test('treats CRLF, lone CR and LF as line breaks with readline numbering', async () => {
    await withTempFile('{"a":1}\r\n{"b":2}\r{"c":3}\n\n{"d":4}', async (path) => {
      const warnings: string[] = [];
      const records = await collectAll(
        splitJsonlRecords(path, { onWarning: (warning) => warnings.push(`${warning.kind}:${warning.line}`) }),
      );
      expect(records).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }]);
      const lines = await scanAll(path);
      expect(lines.map((line) => line.line)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  test('reads records that span many read chunks', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024);
    await withTempFile(`${JSON.stringify({ big })}\n{"after":true}\n`, async (path) => {
      const records = await collectAll(splitJsonlRecords(path));
      expect(records).toEqual([{ big }, { after: true }]);
    });
  });
});

describe('scanJsonlLines', () => {
  test('reports byte offsets and marks an unterminated final line', async () => {
    const first = '{"name":"caf\u00e9"}';
    await withTempFile(`${first}\n{"partial":`, async (path) => {
      const lines = await scanAll(path);
      const firstEnd = Buffer.byteLength(first) + 1;
      expect(lines).toEqual([
        { text: first, line: 1, end: firstEnd, terminated: true },
        { text: '{"partial":', line: 2, end: firstEnd + 11, terminated: false },
      ]);
    });
  });

  test('resumes from a byte offset with file-relative line numbers', async () => {
    await withTempFile('{"a":1}\n{"b":2}\n{"c":3}\n', async (path) => {
      const lines = await scanAll(path, 8, 1);
      expect(lines.map((line) => [line.text, line.line, line.end])).toEqual([
        ['{"b":2}', 2, 16],
        ['{"c":3}', 3, 24],
      ]);
    });
  });

  test('an empty file and a start at end of file yield no lines', async () => {
    await withTempFile('', async (path) => {
      expect(await scanAll(path)).toEqual([]);
    });
    await withTempFile('{"a":1}\n', async (path) => {
      expect(await scanAll(path, 8, 1)).toEqual([]);
    });
  });
});
