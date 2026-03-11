import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { splitJsonlRecords } from './jsonl-splitter';

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

  test('malformed JSON throws with file path and line number', async () => {
    const filePath = join(FIXTURES_DIR, 'malformed.jsonl');

    try {
      await collectAll(splitJsonlRecords(filePath));
      throw new Error('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(
        `Malformed JSON in ${filePath} at line 2`,
      );
    }
  });

  test('oversized record throws with file path and line number', async () => {
    // Create a temporary file with an oversized record
    const tmpPath = join(FIXTURES_DIR, '_oversized_temp.jsonl');
    const smallRecord = JSON.stringify({ id: 1 });
    // Create a record larger than 50 bytes to test with a low limit
    const largeRecord = JSON.stringify({ data: 'x'.repeat(100) });
    await Bun.write(tmpPath, `${smallRecord}\n${largeRecord}\n`);

    const originalEnv = process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'];
    try {
      process.env['TOKENLEAK_MAX_JSONL_RECORD_BYTES'] = '50';

      try {
        await collectAll(splitJsonlRecords(tmpPath));
        throw new Error('Expected an error to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(
          /Oversized JSONL record in .+_oversized_temp\.jsonl at line 2/,
        );
      }
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
});
