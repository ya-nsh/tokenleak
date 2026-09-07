import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Database } from 'bun:sqlite';
import { ClaudeCodeProvider } from './claude-code';
import { CodexProvider } from './codex';
import { OpenCodeProvider } from './open-code';

const range = { since: '2026-03-12', until: '2026-03-13' };
const stamp = '2026-03-12T10:00:00Z';
async function fixture(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'tokenleak-accounting-'));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function jsonl(dir: string, name: string, rows: unknown[]) {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n'));
}
function claude(
  id: string | undefined,
  request: string | undefined,
  input: number,
  output: number,
  timestamp = stamp,
) {
  return {
    type: 'assistant',
    timestamp,
    requestId: request,
    message: {
      id,
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: input, output_tokens: output },
    },
  };
}
function totals(input: number, output = 10, cached = 0) {
  return {
    input_tokens: input,
    output_tokens: output,
    cached_input_tokens: cached,
    reasoning_output_tokens: Math.min(output, 5),
    total_tokens: input + output,
  };
}
function count(
  total: ReturnType<typeof totals> | null,
  last: ReturnType<typeof totals> | null = total,
  timestamp = stamp,
) {
  return {
    type: 'event_msg',
    timestamp,
    payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } },
  };
}
function meta(id: string, parent?: string) {
  return { type: 'session_meta', timestamp: stamp, payload: { id, forked_from_id: parent } };
}
function turn(model = 'gpt-5.4', turn_id = 'turn') {
  return { type: 'turn_context', timestamp: stamp, payload: { model, turn_id } };
}

describe('Claude usage identity', () => {
  it('merges cross-file and out-of-order streaming snapshots monotonically', () =>
    fixture(async (dir) => {
      jsonl(dir, 'a.jsonl', [claude('m', 'r', 100, 5), claude('m', 'r', 90, 20)]);
      jsonl(dir, 'nested/b.jsonl', [claude('m', 'r', 100, 5)]);
      const data = await new ClaudeCodeProvider(dir).load(range);
      expect(data.totalTokens).toBe(120);
      expect(data.events).toHaveLength(1);
    }));
  it('preserves distinct requests and anonymous records even when usage is identical', () =>
    fixture(async (dir) => {
      jsonl(dir, 'a.jsonl', [
        claude('m', 'r1', 10, 1),
        claude('m', 'r2', 10, 1),
        claude(undefined, undefined, 10, 1),
        claude(undefined, undefined, 10, 1),
      ]);
      expect((await new ClaudeCodeProvider(dir).load(range)).totalTokens).toBe(44);
    }));
  it('assigns copied usage to its original day before range filtering', () =>
    fixture(async (dir) => {
      jsonl(dir, 'a.jsonl', [claude('m', 'r', 100, 5)]);
      jsonl(dir, 'b.jsonl', [claude('m', 'r', 100, 5, '2026-03-13T10:00:00Z')]);
      const provider = new ClaudeCodeProvider(dir);
      expect((await provider.load({ since: '2026-03-13', until: '2026-03-13' })).totalTokens).toBe(
        0,
      );
      expect((await provider.load(range)).totalTokens).toBe(105);
    }));
});

describe('Codex request accounting', () => {
  it('counts identical-sized real requests but suppresses repeated and replayed snapshots', () =>
    fixture(async (dir) => {
      const rows = [
        meta('session'),
        turn(),
        count(totals(100)),
        count(totals(100)),
        count(totals(200, 20), totals(100)),
        count(totals(100)),
      ];
      jsonl(dir, 'a.jsonl', rows);
      jsonl(dir, 'copy/b.jsonl', rows);
      const data = await new CodexProvider(dir).load(range);
      expect(data.totalTokens).toBe(220);
      expect(data.events).toHaveLength(2);
    }));
  it('keeps independent sessions with identical counters', () =>
    fixture(async (dir) => {
      for (const id of ['a', 'b'])
        jsonl(dir, `${id}.jsonl`, [meta(id), turn(), count(totals(100))]);
      expect((await new CodexProvider(dir).load(range)).totalTokens).toBe(220);
    }));
  it('uses request increments when cumulative totals include resumed history', () =>
    fixture(async (dir) => {
      jsonl(dir, 'a.jsonl', [meta('a'), turn(), count(totals(10000, 1000), totals(100))]);
      expect((await new CodexProvider(dir).load(range)).totalTokens).toBe(110);
    }));
  it('preserves baselines across model switches and date filters with missing last usage', () =>
    fixture(async (dir) => {
      jsonl(dir, 'a.jsonl', [
        meta('a'),
        turn(),
        count(totals(100), null),
        turn('gpt-5.5'),
        count(totals(300, 30), null, '2026-03-13T01:00:00Z'),
      ]);
      const data = await new CodexProvider(dir).load({ since: '2026-03-13', until: '2026-03-13' });
      expect(data.totalTokens).toBe(220);
      expect(data.events?.[0]?.model).toBe('gpt-5.5');
    }));
  it('does not count cached input or reasoning twice', () =>
    fixture(async (dir) => {
      jsonl(dir, 'a.jsonl', [meta('a'), turn(), count(totals(100, 20, 80))]);
      const data = await new CodexProvider(dir).load(range);
      expect(data.events?.[0]).toMatchObject({
        inputTokens: 20,
        cacheReadTokens: 80,
        outputTokens: 20,
        totalTokens: 120,
      });
    }));
  it('reads explicit request model metadata and never guesses from instruction prose', () =>
    fixture(async (dir) => {
      jsonl(dir, 'a.jsonl', [
        {
          type: 'session_meta',
          payload: { id: 'a', base_instructions: { text: 'You are based on GPT-5.' } },
        },
        { type: 'turn_context', payload: { model_info: { slug: 'gpt-5.5' } } },
        count(totals(100)),
      ]);
      const data = await new CodexProvider(dir).load(range);
      expect(data.events?.[0]?.model).toBe('gpt-5.5');
    }));
  it('excludes parent replay even when copied timestamps are rewritten', () =>
    fixture(async (dir) => {
      const parent = '019ce000-0000-7000-8000-000000000000';
      const child = '019ce001-0000-7000-8000-000000000000';
      const parentTurn = '019ce000-0001-7000-8000-000000000000';
      const childTurn = '019ce001-0001-7000-8000-000000000000';
      jsonl(dir, 'child.jsonl', [
        meta(child, parent),
        meta(parent),
        turn('gpt-5.4', parentTurn),
        count(totals(1000, 100)),
        turn('gpt-5.5', childTurn),
        count(totals(1000, 100)),
        count(totals(1100, 110), totals(100)),
      ]);
      const data = await new CodexProvider(dir).load(range);
      expect(data.totalTokens).toBe(110);
      expect(data.events?.[0]?.model).toBe('gpt-5.5');
    }));
  it('accepts a reset to a new request baseline', () =>
    fixture(async (dir) => {
      jsonl(dir, 'a.jsonl', [
        meta('a'),
        turn(),
        count(totals(1000, 100)),
        count(totals(100, 10)),
        count(totals(200, 20), totals(100, 10)),
      ]);
      expect((await new CodexProvider(dir).load(range)).totalTokens).toBe(1320);
    }));
});

describe('OpenCode storage migration', () => {
  it('unions JSON and SQLite, deduplicates message IDs, and includes reasoning', () =>
    fixture(async (dir) => {
      const message = {
        id: 'm',
        role: 'assistant',
        modelID: 'gpt-5.4',
        time: { created: Date.parse(stamp) },
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 40, write: 10 } },
        cost: 0,
      };
      mkdirSync(join(dir, 'storage/message/session'), { recursive: true });
      writeFileSync(join(dir, 'storage/message/session/m.json'), JSON.stringify(message));
      const db = new Database(join(dir, 'opencode.db'));
      db.exec(
        'CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)',
      );
      const insert = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
      insert.run('m', 'session', Date.parse(stamp), JSON.stringify(message));
      insert.run('fork-copy', 'child', Date.parse(stamp), JSON.stringify(message));
      insert.run('new', 'session', Date.parse(stamp), JSON.stringify({ ...message, id: 'new' }));
      insert.run('bad', 'session', Date.parse(stamp), '{');
      db.close();
      const data = await new OpenCodeProvider(dir).load(range);
      expect(data.totalTokens).toBe(350);
      expect(data.events).toHaveLength(2);
      expect(data.totalCost).toBe(0);
      expect(data.warnings).toContainEqual(expect.objectContaining({ kind: 'parse', count: 1 }));
    }));
  it('reads modern SQLite without JSON and uses row identity/timestamp fallbacks', () =>
    fixture(async (dir) => {
      const db = new Database(join(dir, 'opencode.db'));
      db.exec(
        'CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, role TEXT, data TEXT)',
      );
      db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(
        'm',
        's',
        Date.parse(stamp),
        'assistant',
        JSON.stringify({ modelID: 'gpt-5.4', tokens: { input: 10, output: 0, reasoning: 4 } }),
      );
      db.close();
      const provider = new OpenCodeProvider(dir);
      expect(await provider.isAvailable()).toBe(true);
      expect((await provider.load(range)).totalTokens).toBe(14);
    }));
});

describe('Verified response-ledger boundaries', () => {
  it('retains a real reset request that a stale-regression heuristic would discard', () =>
    fixture(async (dir) => {
      const request = totals(180171, 141, 18944);
      jsonl(dir, 'a.jsonl', [
        meta('a'),
        turn('gpt-6-astra', 'old'),
        count(totals(358960, 351, 197888)),
        turn('gpt-6-astra', 'new'),
        {
          type: 'token_usage_record',
          timestamp: stamp,
          payload: {
            thread_id: 'a',
            turn_id: 'new',
            response_id: 'response-reset',
            usage: request,
          },
        },
        count(request),
        count(totals(363231, 412, 198912), totals(183060, 271, 179968)),
      ]);
      const data = await new CodexProvider(dir).load(range);
      expect(data.totalTokens).toBe(359311 + 180312 + 183331);
      expect(data.events?.filter((event) => event.responseId === 'response-reset')).toHaveLength(1);
    }));
  it('retains unique response records even when no status notification is written', () =>
    fixture(async (dir) => {
      const record = {
        type: 'token_usage_record',
        timestamp: stamp,
        payload: {
          thread_id: 'a',
          turn_id: 'turn',
          response_id: 'request',
          usage: totals(236572, 2782, 231936),
        },
      };
      jsonl(dir, 'a.jsonl', [meta('a'), turn(), record, record]);
      jsonl(dir, 'archive/a.jsonl', [meta('a'), turn(), record]);
      const data = await new CodexProvider(dir).load(range);
      expect(data.totalTokens).toBe(239354);
      expect(data.events).toHaveLength(1);
    }));
  it('keeps unrelated same-named files without upstream session identities', () =>
    fixture(async (dir) => {
      for (const folder of ['one', 'two'])
        jsonl(dir, `${folder}/session.jsonl`, [turn(), count(totals(100))]);
      expect((await new CodexProvider(dir).load(range)).totalTokens).toBe(220);
    }));
  it('allows counter values to repeat after a reset on a new turn', () =>
    fixture(async (dir) => {
      jsonl(dir, 'a.jsonl', [
        meta('a'),
        turn('gpt-5.4', 'first'),
        count(totals(100)),
        count(totals(200, 20), totals(100)),
        turn('gpt-5.4', 'second'),
        count(totals(100)),
        count(totals(200, 20), totals(100)),
      ]);
      expect((await new CodexProvider(dir).load(range)).totalTokens).toBe(440);
    }));
  it('does not let an empty snapshot consume a later real request', () =>
    fixture(async (dir) => {
      jsonl(dir, 'a.jsonl', [
        meta('a'),
        turn(),
        count(totals(100), totals(0, 0)),
        count(totals(100)),
      ]);
      expect((await new CodexProvider(dir).load(range)).totalTokens).toBe(110);
    }));
  it('normalizes offset timestamps to UTC before filtering', () =>
    fixture(async (dir) => {
      const offset = '2026-03-13T01:00:00+05:30';
      jsonl(dir, 'a.jsonl', [meta('a'), turn(), count(totals(100), totals(100), offset)]);
      jsonl(dir, 'claude/b.jsonl', [claude('m', 'r', 100, 10, offset)]);
      const oneDay = { since: '2026-03-12', until: '2026-03-12' };
      expect((await new CodexProvider(dir).load(oneDay)).totalTokens).toBe(110);
      expect((await new ClaudeCodeProvider(join(dir, 'claude')).load(oneDay)).totalTokens).toBe(
        110,
      );
    }));
});

describe('Fork replay variants', () => {
  for (const restartCounter of [false, true]) {
    it(`skips old turns without embedded parent metadata (counter restart=${restartCounter})`, () =>
      fixture(async (dir) => {
        const child = '019ce001-0000-7000-8000-000000000000';
        jsonl(dir, 'child.jsonl', [
          meta(child, 'parent'),
          turn('gpt-5.4', '019ce000-0000-7000-8000-000000000000'),
          count(totals(1000, 100)),
          turn('gpt-5.5', '019ce001-0001-7000-8000-000000000000'),
          count(restartCounter ? totals(100) : totals(1100, 110), totals(100)),
        ]);
        expect((await new CodexProvider(dir).load(range)).totalTokens).toBe(110);
      }));
  }
});

describe('Cursor independent CSV token buckets', () => {
  it('retains cache-write tokens when ordinary input is also present', () =>
    fixture(async (dir) => {
      const { CursorProvider } = await import('./cursor');
      writeFileSync(
        join(dir, 'usage.csv'),
        [
          'Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost',
          `${stamp},claude-sonnet-4-6,19797,8,0,238,20043,$0.00`,
          `${stamp},claude-sonnet-4-6,10,100,50,20,180,$0.00`,
        ].join('\n'),
      );
      const data = await new CursorProvider(dir).load(range);
      expect(data.events?.map((event) => event.totalTokens)).toEqual([20043, 180]);
      expect(data.events?.[0]).toMatchObject({
        inputTokens: 8,
        cacheWriteTokens: 19797,
        outputTokens: 238,
      });
      expect(data.events?.[1]).toMatchObject({ inputTokens: 100, cacheWriteTokens: 10 });
      expect(data.totalTokens).toBe(20223);
    }));
});
