import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReceipt } from '@tokenleak/core';
import { CodexProvider } from './codex';
import { ClaudeCodeProvider } from './claude-code';

test.each(['codex', 'claude'])('tracks repeated submissions separately from responses for %s', async (name) => {
  const root = mkdtempSync(join(tmpdir(), 'tokenleak-prompts-'));
  try {
    const timestamp = '2026-03-12T10:00:00Z';
    const user = name === 'codex'
      ? { type: 'event_msg', timestamp, payload: { type: 'user_message', message: 'Implement this feature' } }
      : { type: 'user', timestamp, message: { role: 'user', content: 'Implement this feature' } };
    const response = (id: string) => name === 'codex'
      ? { type: 'token_usage_record', timestamp, payload: { model: 'gpt-5.5', response_id: id, usage: { input_tokens: 100, output_tokens: 10 } } }
      : { type: 'assistant', timestamp, message: { id, model: 'claude-sonnet-4', usage: { input_tokens: 100, output_tokens: 10 } } };
    writeFileSync(join(root, 's.jsonl'), [user, response('r1'), response('r2'), user, response('r3')].map((row) => JSON.stringify(row)).join('\n'));
    const range = { since: '2026-03-12', until: '2026-03-12' };
    const data = await (name === 'codex' ? new CodexProvider(root) : new ClaudeCodeProvider(root)).load(range);
    expect(data.events).toHaveLength(3);
    expect(new Set(data.events!.map((e) => e.promptId)).size).toBe(2);
    expect(buildReceipt(data.events!, range).summary.accountedPrompts).toBe(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('keeps identical submissions in separate fragments of one Codex session distinct', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tokenleak-prompt-fragments-'));
  try {
    const timestamp = '2026-03-12T10:00:00Z';
    for (const i of [1, 2]) {
      writeFileSync(join(root, `part-${i}.jsonl`), [
        { type: 'session_meta', payload: { id: 'same-session' } },
        { type: 'event_msg', timestamp, payload: { type: 'user_message', message: 'Implement this feature' } },
        { type: 'token_usage_record', timestamp, payload: { model: 'gpt-5.5', turn_id: `t${i}`, response_id: `r${i}`, usage: { input_tokens: 100, output_tokens: 10 } } },
      ].map((row) => JSON.stringify(row)).join('\n'));
    }
    const range = { since: '2026-03-12', until: '2026-03-12' };
    const data = await new CodexProvider(root).load(range);
    expect(data.events).toHaveLength(2);
    expect(buildReceipt(data.events!, range).summary.accountedPrompts).toBe(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
