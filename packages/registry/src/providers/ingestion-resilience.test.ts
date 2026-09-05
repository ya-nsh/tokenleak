import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { buildReplayReport, buildSessionRollups } from '@tokenleak/core';
import { ClaudeCodeProvider } from './claude-code';
import { CodexProvider } from './codex';
import { KiroProvider } from './kiro';
import { OpenClawProvider } from './openclaw';
import { timestampToIso } from './local-usage';

const range = { since: '2026-03-12', until: '2026-03-13' };
const timestamp = '2026-03-12T10:00:00Z';
const roots: string[] = [];
function temporary() { const root = mkdtempSync(join(tmpdir(), 'tokenleak-ingestion-')); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const assistant = (time = timestamp, output = 10) => ({ type: 'assistant', timestamp: time,
  message: { id: 'message-1', model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: output } } });
const jsonl = (root: string, rows: unknown[]) => writeFileSync(join(root, 'session.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n'));

test.each(['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'])(
  'rejects negative Claude %s without discarding valid messages', async (field) => {
    const root = temporary(); const invalid = assistant();
    (invalid.message.usage as Record<string, number>)[field] = -1000;
    jsonl(root, [invalid, { ...assistant(), message: { ...assistant().message, id: 'valid' } }]);
    expect((await new ClaudeCodeProvider(root).load(range)).totalTokens).toBe(110);
  },
);

test('deduplicates Claude message snapshots before midnight filtering', async () => {
  const root = temporary(); jsonl(root, [assistant('2026-03-12T23:59:59Z', 1), assistant('2026-03-13T00:00:01Z', 2)]);
  const provider = new ClaudeCodeProvider(root);
  expect((await provider.load(range)).totalTokens).toBe(102);
  expect((await provider.load({ since: range.since, until: range.since })).totalTokens).toBe(0);
  expect((await provider.load({ since: range.until, until: range.until })).totalTokens).toBe(102);
});

test('dangling links and directory cycles do not hide valid Claude or Codex sessions', async () => {
  const root = temporary();
  jsonl(root, [assistant(), { type: 'turn_context', timestamp, payload: { model: 'gpt-5.5' } },
    { type: 'token_usage_record', timestamp, payload: { response_id: 'r1', usage: { input_tokens: 100, output_tokens: 10 } } }]);
  symlinkSync(join(root, 'missing'), join(root, 'dangling')); symlinkSync(root, join(root, 'cycle'));
  expect((await new ClaudeCodeProvider(root).load(range)).totalTokens).toBe(110);
  expect((await new CodexProvider(root).load(range)).totalTokens).toBe(110);
});

const kiro = (times = [timestamp]) => ({ session_id: 'session-1', session_state: {
  rts_model_state: { model_info: { model_id: 'claude-sonnet-4' } },
  conversation_metadata: { user_turn_metadatas: times.map((end_timestamp) => ({ end_timestamp, input_token_count: 100, output_token_count: 10 })) },
} });
function database(root: string, histories: string[]) {
  const path = join(root, 'data.db'); const db = new Database(path);
  try { db.exec('CREATE TABLE conversations_v2 (id TEXT, history TEXT)');
    histories.forEach((history, i) => db.query('INSERT INTO conversations_v2 VALUES (?, ?)').run(String(i), history));
  } finally { db.close(); }
  return path;
}

test('Kiro reconciles overlapping stores while preserving distinct turns in one session', async () => {
  const root = temporary(); const value = kiro([timestamp, '2026-03-12T10:01:00Z']);
  writeFileSync(join(root, 'session.json'), JSON.stringify(value));
  const path = database(root, [JSON.stringify(value)]);
  const data = await new KiroProvider(root, path).load(range);
  expect(data.totalTokens).toBe(220); expect(data.events).toHaveLength(2);
  const sessions = buildSessionRollups(data.events!);
  expect(sessions).toHaveLength(1); expect(sessions[0]!.durationMs).toBe(60_000);
});

test('Kiro retains valid database rows and reports malformed histories', async () => {
  const root = temporary(); const path = database(root, [JSON.stringify(kiro()), '{broken']);
  const data = await new KiroProvider(root, path).load(range);
  expect(data.totalTokens).toBe(110); expect(data.warnings).toContainEqual({ kind: 'parse', file: path, count: 1 });
});

test('Kiro selects the latest overlapping turn before filtering its day', async () => {
  const root = temporary(); writeFileSync(join(root, 'session.json'), JSON.stringify(kiro()));
  const path = database(root, [JSON.stringify(kiro(['2026-03-13T00:00:01Z']))]);
  expect((await new KiroProvider(root, path).load({ since: range.since, until: range.since })).totalTokens).toBe(0);
});

test('invalid local timestamps cannot crash Replay and valid records survive', async () => {
  const root = temporary();
  jsonl(root, ['2026-03-12garbage', timestamp].map((time) => ({ type: 'message', timestamp: time,
    message: { role: 'assistant', model: 'gpt-5.5', usage: { input: 100, output: 10 } } })));
  // Invalid timestamps may fall back to file time; neither path may emit an invalid event.
  const data = await new OpenClawProvider(root).load(range);
  expect(data.events!.every((event) => Number.isFinite(Date.parse(event.timestamp)))).toBe(true);
  expect(() => buildReplayReport([data], range.since)).not.toThrow();
  expect(timestampToIso('2026-02-30T10:00:00Z')).toBeNull();
  expect(timestampToIso('2026-03-12garbage')).toBeNull();
  expect(timestampToIso(timestamp)).toBe(timestamp);
});
