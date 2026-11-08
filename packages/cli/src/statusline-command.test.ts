import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CostCompleteness } from '@tokenleak/core';
import { runStatusline } from './commands/statusline';
import type { StatuslineDeps } from './commands/statusline';
import { computeDateRange } from './date-range';
import { STATUSLINE_HISTORY_DAYS } from './statusline';
import type { StatuslineSummary } from './statusline';
import {
  MAX_SERVE_AGE_MS,
  REFRESH_AFTER_MS,
  REFRESH_TOKEN_ENV,
  SNAPSHOT_SWITCH_ENV,
  STATUSLINE_SNAPSHOT_VERSION,
} from './statusline-snapshot';
import type { StatuslineSnapshot } from './statusline-snapshot';

const CLI_PATH = join(import.meta.dir, 'cli.ts');
const FIXTURE_MESSAGES = 30;
const REFRESH_WAIT_MS = 30_000;
const POLL_MS = 100;

const complete = (tokens: number): CostCompleteness => ({
  status: 'complete',
  totalTokens: tokens,
  pricedTokens: tokens,
  unpricedTokens: 0,
  unknownModels: [],
});
const summaryCosting = (cost: number): StatuslineSummary => ({
  today: { tokens: 100, cost, completeness: complete(100) },
  week: { tokens: 700, cost: cost * 7, completeness: complete(700) },
  streak: 3,
});
const today = () => computeDateRange({ days: STATUSLINE_HISTORY_DAYS }).until;

/** Wall-clock based: refresh locks are judged by their real file modification time. */
let START: number;
let dir: string;
let clock: number;
let computed: number;
let nextCost: number;
let computeFails: boolean;
let spawned: string[];
let spawnWorks: boolean;
let printed: string[];
let env: NodeJS.ProcessEnv;

function deps(): StatuslineDeps {
  return {
    now: () => clock,
    env,
    snapshotDirectory: () => join(dir, 'statusline'),
    computeSummary: async () => {
      computed++;
      if (computeFails) throw new Error('logs unreadable');
      return summaryCosting(nextCost);
    },
    startBackgroundRefresh: (token) => {
      spawned.push(token);
      return spawnWorks;
    },
    write: async (rendered) => {
      printed.push(rendered);
    },
  };
}

const run = (cliArgs: Record<string, unknown> = { noColor: true }) => runStatusline({ noColor: true, ...cliArgs }, deps());
const snapshotFiles = () => readdirSync(join(dir, 'statusline')).filter((name) => name.endsWith('.json'));
const lockFiles = () => readdirSync(join(dir, 'statusline')).filter((name) => name.endsWith('.lock'));
function storedSnapshot(): StatuslineSnapshot {
  const [file] = snapshotFiles();
  return JSON.parse(readFileSync(join(dir, 'statusline', file!), 'utf8')) as StatuslineSnapshot;
}
function rewriteSnapshot(change: (snapshot: StatuslineSnapshot) => void): void {
  const [file] = snapshotFiles();
  const snapshot = storedSnapshot();
  change(snapshot);
  writeFileSync(join(dir, 'statusline', file!), JSON.stringify(snapshot));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tokenleak-statusline-cmd-'));
  START = Date.now();
  clock = START;
  computed = 0;
  nextCost = 1;
  computeFails = false;
  spawned = [];
  spawnWorks = true;
  printed = [];
  env = { HOME: '/home/test' };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runStatusline with a snapshot', () => {
  test('computes the first line, then serves it without reading logs', async () => {
    await run();
    expect(computed).toBe(1);
    expect(printed[0]).toContain('$1.00 today');
    expect(storedSnapshot()).toMatchObject({ version: STATUSLINE_SNAPSHOT_VERSION, today: today(), computedAt: START });

    nextCost = 2;
    clock = START + REFRESH_AFTER_MS - 1;
    await run();
    expect(computed).toBe(1);
    expect(spawned).toEqual([]);
    expect(printed[1]).toBe(printed[0]!);
  });

  test('serves a stale line at once and starts one background refresh', async () => {
    await run();
    clock = START + REFRESH_AFTER_MS;
    await run();
    expect(printed[1]).toContain('$1.00 today');
    expect(computed).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(lockFiles()).toHaveLength(1);

    // While that refresh runs, later calls do not start another.
    await run();
    expect(spawned).toHaveLength(1);
  });

  test('a refresh that cannot start gives up its lock so the next call retries', async () => {
    await run();
    clock = START + REFRESH_AFTER_MS;
    spawnWorks = false;
    await run();
    expect(lockFiles()).toEqual([]);
    await run();
    expect(spawned).toHaveLength(2);
  });

  test('recomputes in the foreground when the line is from another day or too old', async () => {
    await run();
    rewriteSnapshot((snapshot) => (snapshot.today = '2000-01-31'));
    nextCost = 2;
    await run();
    expect(computed).toBe(2);
    expect(printed[1]).toContain('$2.00 today');

    clock = START + MAX_SERVE_AGE_MS + 1;
    nextCost = 3;
    await run();
    expect(computed).toBe(3);
    expect(printed[2]).toContain('$3.00 today');
    expect(spawned).toEqual([]);
  });

  test('a different provider selection gets its own snapshot', async () => {
    await run();
    await run({ provider: 'claude' });
    expect(computed).toBe(2);
    expect(snapshotFiles()).toHaveLength(2);
  });

  test('json output says when the numbers were computed', async () => {
    await run();
    clock = START + 1_000;
    await run({ format: 'json' });
    const json = JSON.parse(printed[1]!) as StatuslineSummary & { updatedAt: string };
    expect(json.updatedAt).toBe(new Date(START).toISOString());
    expect(json.today.cost).toBe(1);
    expect(json.streak).toBe(3);
  });

  test(`${SNAPSHOT_SWITCH_ENV}=0 computes every time and stores nothing`, async () => {
    env = { ...env, [SNAPSHOT_SWITCH_ENV]: '0' };
    await run();
    await run();
    expect(computed).toBe(2);
    expect(existsSync(join(dir, 'statusline'))).toBe(false);
  });

  test('a failing first computation propagates, so the CLI reports it', async () => {
    computeFails = true;
    await expect(run()).rejects.toThrow('logs unreadable');
    expect(printed).toEqual([]);
  });
});

describe('runStatusline as the background refresh', () => {
  async function staleWithLock(): Promise<string> {
    await run();
    clock = START + REFRESH_AFTER_MS;
    await run();
    return spawned[0]!;
  }

  test('stores a new snapshot, releases its lock and prints nothing', async () => {
    const token = await staleWithLock();
    env = { ...env, [REFRESH_TOKEN_ENV]: token };
    nextCost = 5;
    printed = [];
    await run();
    expect(printed).toEqual([]);
    expect(storedSnapshot()).toMatchObject({ computedAt: START + REFRESH_AFTER_MS, summary: summaryCosting(5) });
    expect(lockFiles()).toEqual([]);
  });

  test('a failed refresh keeps its lock, which spaces out retries', async () => {
    const token = await staleWithLock();
    env = { ...env, [REFRESH_TOKEN_ENV]: token };
    computeFails = true;
    await expect(run()).rejects.toThrow('logs unreadable');
    expect(lockFiles()).toHaveLength(1);
    expect(storedSnapshot().summary).toEqual(summaryCosting(1));
  });
});

describe('tokenleak statusline (process)', () => {
  let root: string;
  let processEnv: Record<string, string>;
  const statuslineDir = () => join(root, 'cache', 'statusline');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tokenleak-statusline-proc-'));
    const project = join(root, 'claude', 'projects', '-tmp-app');
    mkdirSync(project, { recursive: true });
    const timestamp = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
    const lines = Array.from({ length: FIXTURE_MESSAGES }, (_, i) =>
      JSON.stringify({
        type: 'assistant',
        timestamp,
        requestId: `req_${i}`,
        message: {
          id: `msg_${i}`,
          model: 'claude-sonnet-4-5-20250929',
          usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
    );
    writeFileSync(join(project, 'session.jsonl'), `${lines.join('\n')}\n`);
    const home = join(root, 'home');
    mkdirSync(home);
    processEnv = {
      PATH: process.env['PATH'] ?? '',
      HOME: home,
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_CONFIG_HOME: join(home, '.config'),
      CLAUDE_CONFIG_DIR: join(root, 'claude'),
      TOKENLEAK_CACHE_DIR: join(root, 'cache'),
      TOKENLEAK_OFFLINE: '1',
    };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function statusline(): Promise<{ week: { tokens: number }; updatedAt: string }> {
    const proc = Bun.spawn(['bun', CLI_PATH, 'statusline', '--format', 'json', '--provider', 'claude'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: processEnv,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(code, stderr).toBe(0);
    return JSON.parse(stdout) as { week: { tokens: number }; updatedAt: string };
  }

  test(
    'serves a stale snapshot, then a detached refresh replaces it',
    async () => {
      const fresh = await statusline();
      expect(fresh.week.tokens).toBe(FIXTURE_MESSAGES * 100);

      const [file] = readdirSync(statuslineDir()).filter((name) => name.endsWith('.json'));
      const path = join(statuslineDir(), file!);
      const stale = JSON.parse(readFileSync(path, 'utf8')) as StatuslineSnapshot;
      stale.computedAt = Date.now() - REFRESH_AFTER_MS - 1_000;
      stale.summary.week.tokens = 1;
      writeFileSync(path, JSON.stringify(stale));

      expect((await statusline()).week.tokens).toBe(1);

      const deadline = Date.now() + REFRESH_WAIT_MS;
      let refreshed = stale;
      while (Date.now() < deadline) {
        refreshed = JSON.parse(readFileSync(path, 'utf8')) as StatuslineSnapshot;
        if (refreshed.computedAt !== stale.computedAt) break;
        await Bun.sleep(POLL_MS);
      }
      expect(refreshed.summary.week.tokens).toBe(FIXTURE_MESSAGES * 100);
      expect(readdirSync(statuslineDir()).filter((name) => name.endsWith('.lock'))).toEqual([]);
    },
    REFRESH_WAIT_MS + 30_000,
  );
});
