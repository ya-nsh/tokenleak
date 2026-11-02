import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { flushStream } from './exit';

describe('flushStream', () => {
  test('resolves immediately when nothing is buffered', async () => {
    let wrote = false;
    await flushStream({ writableLength: 0, write: () => ((wrote = true), true) });
    expect(wrote).toBe(false);
  });

  test('waits for the write callback when output is buffered', async () => {
    let done: (() => void) | undefined;
    const pending = flushStream({
      writableLength: 10,
      write: (_chunk, callback) => {
        done = () => callback();
        return false;
      },
    });
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    done!();
    await pending;
    expect(settled).toBe(true);
  });
});

describe('exitAfterFlush', () => {
  test('a piped child that writes 1 MB and exits delivers every byte', async () => {
    const exitModule = join(import.meta.dir, 'exit.ts');
    const script = `
      import { exitAfterFlush } from ${JSON.stringify(exitModule)};
      process.stdout.write('x'.repeat(1_048_576));
      await exitAfterFlush(0);
    `;
    const proc = Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
    const text = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(text.length).toBe(1_048_576);
  });
});
