import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { Mock } from 'bun:test';
import { runDefaultCommand } from './cli';

describe('runDefaultCommand', () => {
  const originalArgv = process.argv;
  let stdout: Mock<typeof process.stdout.write> | null = null;

  afterEach(() => {
    process.argv = originalArgv;
    stdout?.mockRestore();
    stdout = null;
  });

  test('reports the TUI as interactive so the process is not force-exited', async () => {
    let started = 0;
    const outcome = await runDefaultCommand([], {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      startTui: async () => {
        started += 1;
      },
    });
    expect(outcome).toBe('interactive');
    expect(started).toBe(1);
  });

  test('help is a finished command and never starts the TUI', async () => {
    stdout = spyOn(process.stdout, 'write').mockImplementation(() => true);
    const outcome = await runDefaultCommand(['--help'], {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      startTui: async () => {
        throw new Error('TUI must not start for --help');
      },
    });
    expect(outcome).toBe('finished');
  });
});
