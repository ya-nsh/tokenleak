import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardOutputStreams, isBrokenPipe, outputErrorAction } from './output-streams';

const CLI_PATH = join(import.meta.dir, 'cli.ts');
/** Enough assistant messages that the JSON report far exceeds a pipe buffer. */
const FIXTURE_MESSAGES = 2_000;
/** Bytes a reader takes before closing the pipe. */
const EARLY_READ_BYTES = 10;
const PROCESS_TIMEOUT_MS = 60_000;

const errorWithCode = (code: string, message = `${code}: write failed`) =>
  Object.assign(new Error(message), { code, syscall: 'write' });

describe('isBrokenPipe', () => {
  test('recognises EPIPE errors only', () => {
    expect(isBrokenPipe(errorWithCode('EPIPE'))).toBe(true);
    expect(isBrokenPipe({ code: 'EPIPE' })).toBe(true);
    expect(isBrokenPipe(errorWithCode('ENOSPC'))).toBe(false);
    expect(isBrokenPipe(new Error('EPIPE in the message only'))).toBe(false);
    expect(isBrokenPipe(null)).toBe(false);
    expect(isBrokenPipe('EPIPE')).toBe(false);
  });
});

describe('outputErrorAction', () => {
  test('a broken pipe exits 0 silently when the command has not failed', () => {
    expect(outputErrorAction('stdout', errorWithCode('EPIPE'), undefined)).toEqual({ exitCode: 0, message: null });
    expect(outputErrorAction('stdout', errorWithCode('EPIPE'), 0)).toEqual({ exitCode: 0, message: null });
    expect(outputErrorAction('stderr', errorWithCode('EPIPE'), undefined)).toEqual({ exitCode: 0, message: null });
  });

  test('a broken pipe keeps a failure the command already recorded', () => {
    expect(outputErrorAction('stdout', errorWithCode('EPIPE'), 1)).toEqual({ exitCode: 1, message: null });
    expect(outputErrorAction('stderr', errorWithCode('EPIPE'), 3)).toEqual({ exitCode: 3, message: null });
  });

  test('any other stdout failure exits 1 with an actionable message', () => {
    const action = outputErrorAction('stdout', errorWithCode('ENOSPC', 'no space left on device'), undefined);
    expect(action.exitCode).toBe(1);
    expect(action.message).toBe(
      'Error: could not write output to stdout: no space left on device. Check that the destination is writable.\n',
    );
    expect(outputErrorAction('stdout', 'odd failure', 0).message).toContain('odd failure');
  });

  test('a stderr failure exits 1 without trying to report on stderr', () => {
    expect(outputErrorAction('stderr', errorWithCode('EIO'), undefined)).toEqual({ exitCode: 1, message: null });
  });
});

describe('guardOutputStreams', () => {
  function guarded(exitCode?: number) {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const reported: string[] = [];
    const exits: number[] = [];
    guardOutputStreams({
      stdout,
      stderr,
      reportError: (message) => reported.push(message),
      currentExitCode: () => exitCode,
      exit: (code) => exits.push(code),
    });
    return { stdout, stderr, reported, exits };
  }

  test('ends the process quietly when stdout or stderr loses its reader', () => {
    const streams = guarded();
    streams.stdout.emit('error', errorWithCode('EPIPE'));
    streams.stderr.emit('error', errorWithCode('EPIPE'));
    expect(streams.exits).toEqual([0, 0]);
    expect(streams.reported).toEqual([]);
  });

  test('reports a real stdout failure and exits 1', () => {
    const streams = guarded();
    streams.stdout.emit('error', errorWithCode('EIO', 'i/o error'));
    expect(streams.exits).toEqual([1]);
    expect(streams.reported).toHaveLength(1);
    expect(streams.reported[0]).toContain('i/o error');
  });

  test('keeps the exit code a command already set', () => {
    const streams = guarded(1);
    streams.stdout.emit('error', errorWithCode('EPIPE'));
    expect(streams.exits).toEqual([1]);
  });
});

describe('tokenleak with piped output (process)', () => {
  let root: string;
  let env: Record<string, string>;
  const reportArgs = ['--format', 'json', '--provider', 'claude', '--since', '2026-01-01', '--until', '2026-01-31'];

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'tokenleak-pipe-'));
    const project = join(root, 'claude', 'projects', '-tmp-app');
    mkdirSync(project, { recursive: true });
    const lines = Array.from({ length: FIXTURE_MESSAGES }, (_, i) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: new Date(Date.UTC(2026, 0, 2 + (i % 28), 12)).toISOString(),
        requestId: `req_${i}`,
        message: {
          id: `msg_${i}`,
          model: 'claude-sonnet-4-5-20250929',
          usage: { input_tokens: 100 + i, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
    );
    writeFileSync(join(project, 'session.jsonl'), `${lines.join('\n')}\n`);
    const home = join(root, 'home');
    mkdirSync(home);
    // Keep every other provider, cache and network lookup away from the real machine.
    env = {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_CONFIG_HOME: join(home, '.config'),
      CLAUDE_CONFIG_DIR: join(root, 'claude'),
      TOKENLEAK_CACHE_DIR: join(root, 'cache'),
      TOKENLEAK_USAGE_CACHE: '0',
      TOKENLEAK_OFFLINE: '1',
      NO_COLOR: '1',
    };
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /** Run the CLI into `reader` through a shell pipe; returns the CLI's own exit status and stderr. */
  async function runPiped(reader: string): Promise<{ status: number; stderr: string; read: string }> {
    const statusFile = join(root, 'status');
    const stderrFile = join(root, 'stderr');
    const cli = ['bun', CLI_PATH, ...reportArgs].map((part) => `'${part}'`).join(' ');
    const proc = Bun.spawn(['sh', '-c', `{ ${cli} 2>'${stderrFile}'; echo $? > '${statusFile}'; } | ${reader}`], {
      stdout: 'pipe',
      stderr: 'pipe',
      env,
    });
    const read = await new Response(proc.stdout).text();
    await proc.exited;
    return {
      status: Number(readFileSync(statusFile, 'utf8').trim()),
      stderr: readFileSync(stderrFile, 'utf8'),
      read,
    };
  }

  test(
    'exits 0 without a stack trace when the reader closes early',
    async () => {
      const result = await runPiped(`head -c ${EARLY_READ_BYTES}`);
      expect(result.read).toHaveLength(EARLY_READ_BYTES);
      expect(result.stderr).not.toContain('EPIPE');
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    },
    PROCESS_TIMEOUT_MS,
  );

  test(
    'still delivers the whole report to a reader that reads everything',
    async () => {
      const result = await runPiped('cat');
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const report = JSON.parse(result.read) as { providers: { events: unknown[] }[] };
      expect(report.providers[0]!.events).toHaveLength(FIXTURE_MESSAGES);
    },
    PROCESS_TIMEOUT_MS,
  );
});
