import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const EXIT_MODULE = join(import.meta.dir, 'exit.ts');
const ONE_MB = 1_048_576;

/** Run a script whose stdout goes through a real shell pipe, like `tokenleak … | jq`. */
async function bytesThroughPipe(script: string): Promise<number> {
  const proc = Bun.spawn(['sh', '-c', `bun -e '${script.replace(/'/g, "'\\''")}' | wc -c`], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return Number(out.trim());
}

describe('finishCommand', () => {
  test('delivers every byte through a shell pipe, repeatedly', async () => {
    const script = `
      import { finishCommand } from "${EXIT_MODULE}";
      async function command() {
        process.stdout.write("x".repeat(${ONE_MB}));
        return finishCommand(0);
      }
      await command();
    `;
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await bytesThroughPipe(script)).toBe(ONE_MB);
    }
  });

  test('sets the exit code', async () => {
    const script = `
      import { finishCommand } from "${EXIT_MODULE}";
      process.stdout.write("done");
      finishCommand(3);
    `;
    const proc = Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
    expect(await new Response(proc.stdout).text()).toBe('done');
    expect(await proc.exited).toBe(3);
  });

  test('a stray handle cannot hold the process open forever', async () => {
    const script = `
      import { finishCommand } from "${EXIT_MODULE}";
      setInterval(() => {}, 1_000);
      finishCommand(0);
    `;
    const started = Date.now();
    const proc = Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
    expect(await proc.exited).toBe(0);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 20_000);
});
