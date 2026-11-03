import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderColors, ProviderData, RenderOptions, UsageEvent } from '@tokenleak/core';
import { buildReplayReport } from '@tokenleak/core';
import { TokenleakError } from '../errors';
import { buildLiveSiteContent, parsePort, parseServeArgs } from './serve';

const CLI_PATH = join(import.meta.dir, '..', 'cli.ts');
const PI_FIXTURES = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'registry',
  'src',
  '__fixtures__',
  'pi',
  'agent',
);
const SERVER_START_TIMEOUT_MS = 20_000;

const COLORS: ProviderColors = {
  primary: '#111111',
  secondary: '#222222',
  gradient: ['#111111', '#222222'],
};
const RENDER_OPTIONS: RenderOptions = {
  format: 'terminal',
  theme: 'dark',
  width: 80,
  showInsights: true,
  noColor: true,
  output: null,
  more: true,
};

function event(timestamp: string): UsageEvent {
  return {
    provider: 'codex',
    timestamp,
    date: timestamp.slice(0, 10),
    model: 'gpt-5.4',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 20,
    cacheWriteTokens: 5,
    totalTokens: 175,
    cost: 0.01,
  };
}

function provider(events: UsageEvent[]): ProviderData {
  return {
    provider: 'codex',
    displayName: 'Codex',
    colors: COLORS,
    daily: [],
    totalTokens: events.reduce((sum, e) => sum + e.totalTokens, 0),
    totalCost: events.reduce((sum, e) => sum + e.cost, 0),
    events,
  };
}

describe('parsePort', () => {
  test('accepts 0 and the full port range', () => {
    expect(parsePort('0')).toBe(0);
    expect(parsePort('3333')).toBe(3333);
    expect(parsePort('65535')).toBe(65_535);
  });

  test.each(['-1', '65536', '3.5', 'abc', ''])('rejects %p', (value) => {
    expect(() => parsePort(value)).toThrow(TokenleakError);
  });
});

describe('parseServeArgs', () => {
  test('parses serve flags and provider filters', () => {
    expect(
      parseServeArgs([
        '--port',
        '4000',
        '--open',
        '-t',
        'light',
        '--days',
        '7',
        '--claude',
        '-p',
        'codex',
      ]),
    ).toEqual({ port: 4000, open: true, theme: 'light', days: 7, claude: true, provider: 'codex' });
  });

  test('returns no flags for empty argv', () => {
    expect(parseServeArgs([])).toEqual({});
  });

  test('rejects an unknown theme', () => {
    expect(() => parseServeArgs(['--theme', 'neon'])).toThrow(
      '--theme must be one of: dark, light',
    );
  });

  test('rejects a flag missing its value', () => {
    expect(() => parseServeArgs(['--port'])).toThrow('Missing value for --port');
  });

  test('rejects flags that only make sense for file output', () => {
    expect(() => parseServeArgs(['--output', 'x.html'])).toThrow('Unknown flag "--output"');
  });
});

describe('buildLiveSiteContent', () => {
  const range = { since: '2026-03-10', until: '2026-03-12' };

  test('builds every page from one load', () => {
    const providers = [
      provider([event('2026-03-10T09:00:00.000Z'), event('2026-03-11T09:00:00.000Z')]),
    ];
    const content = buildLiveSiteContent(providers, range, RENDER_OPTIONS);

    expect(content.dashboard?.output.providers).toBe(providers);
    expect(content.dashboard?.options).toBe(RENDER_OPTIONS);
    expect(content.wrapped).toBe(content.dashboard?.output);
    expect(content.wrapped?.more).not.toBeNull();
    expect(content.wrapped?.optimization).toBeDefined();
    // The replay page opens on the latest active day, not the end of the range.
    expect(
      content.replay && 'initialDate' in content.replay ? content.replay.initialDate : null,
    ).toBe('2026-03-11');
  });

  test('uses an explicit replay page when given', () => {
    const replay = buildReplayReport([], '2026-03-12');
    expect(buildLiveSiteContent([], range, RENDER_OPTIONS, replay).replay).toBe(replay);
  });

  test('falls back to the end of the range when there are no events', () => {
    const content = buildLiveSiteContent([], range, RENDER_OPTIONS);
    expect(
      content.replay && 'initialDate' in content.replay ? content.replay.initialDate : null,
    ).toBe('2026-03-12');
  });
});

/** Read stderr until `pattern` matches, returning the match. */
async function waitForStderr(
  stream: ReadableStream<Uint8Array>,
  pattern: RegExp,
): Promise<RegExpMatchArray> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const match = text.match(pattern);
      if (match) return match;
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(`stderr never matched ${pattern}:\n${text}`);
}

describe('tokenleak serve (process)', () => {
  test('serves every page on one port and exits 0 on SIGINT', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenleak-serve-'));
    cpSync(PI_FIXTURES, join(root, 'pi-agent'), { recursive: true });
    const proc = Bun.spawn(
      ['bun', CLI_PATH, 'serve', '--port', '0', '--provider', 'pi', '--since', '2020-01-01'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, PI_CODING_AGENT_DIR: join(root, 'pi-agent') },
      },
    );
    try {
      const [, base] = await waitForStderr(
        proc.stderr,
        /tokenleak live at (http:\/\/localhost:\d+\/)/,
      );
      for (const path of ['', 'dashboard', 'wrapped', 'replay']) {
        expect((await fetch(`${base}${path}`)).status).toBe(200);
      }
      proc.kill('SIGINT');
      expect(await proc.exited).toBe(0);
    } finally {
      proc.kill();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--live-server is an alias that lists the dashboard first', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenleak-serve-'));
    cpSync(PI_FIXTURES, join(root, 'pi-agent'), { recursive: true });
    const proc = Bun.spawn(
      ['bun', CLI_PATH, '--live-server', '--provider', 'pi', '--since', '2020-01-01'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, PI_CODING_AGENT_DIR: join(root, 'pi-agent') },
      },
    );
    try {
      const [, first] = await waitForStderr(proc.stderr, /tokenleak live at .*\n {2}(\S+)/);
      expect(first).toBe('Dashboard');
      proc.kill('SIGINT');
      expect(await proc.exited).toBe(0);
    } finally {
      proc.kill();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
