import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawProvider } from './openclaw';

test.each([false, true])('OpenClaw merges Fast aliases without losing tier costs (%s)', async (fastFirst) => {
  const root = mkdtempSync(join(tmpdir(), 'tokenleak-fast-'));
  try {
    const models = ['gpt-5.5', 'gpt-5.5-fast'];
    if (fastFirst) models.reverse();
    writeFileSync(join(root, 'session.jsonl'), models.map((model) => JSON.stringify({
      type: 'message', timestamp: '2026-03-12T10:00:00Z',
      message: { role: 'assistant', model, usage: { input: 1000, output: 100 } },
    })).join('\n'));
    const data = await new OpenClawProvider(root).load({ since: '2026-03-12', until: '2026-03-12' });
    const model = data.daily[0]!.models[0]!;
    expect(data.daily[0]!.models).toHaveLength(1);
    expect(model.model).toBe('gpt-5.5');
    expect(data.totalCost).toBeCloseTo(0.028, 8);
    expect(data.events!.find((event) => event.serviceTier === 'fast')?.cost).toBeCloseTo(0.02, 8);
    expect(model.serviceTiers).toEqual([
      { tier: 'fast', tokens: 1100, cost: 0.02, unpricedTokens: 0 },
      { tier: 'unknown', tokens: 1100, cost: 0.008, unpricedTokens: 0 },
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
