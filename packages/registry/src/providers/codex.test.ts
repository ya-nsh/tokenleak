import { describe, it, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DateRange } from '@tokenleak/core';
import { CodexProvider } from './codex';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'codex', 'sessions');
const CURRENT_FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'codex-current', 'sessions');
const NONEXISTENT_DIR = join(import.meta.dir, '..', '__fixtures__', 'codex', 'does-not-exist');
const EMPTY_DIR = join(import.meta.dir, '..', '__fixtures__', 'codex-empty');

const FULL_RANGE: DateRange = { since: '2025-06-01', until: '2025-06-30' };
const CURRENT_RANGE: DateRange = { since: '2026-03-12', until: '2026-03-12' };

function turn(model: string) {
  return { timestamp: '2026-03-12T10:00:00Z', type: 'turn_context', payload: { model } };
}

function tokens(input: number, output: number, options: { last?: boolean; timestamp?: string; cached?: number } = {}) {
  const usage = { input_tokens: input, output_tokens: output, cached_input_tokens: options.cached ?? 0 };
  return { timestamp: options.timestamp ?? '2026-03-12T10:01:00Z', type: 'event_msg', payload: {
    type: 'token_count', info: { total_token_usage: usage,
      ...(options.last === false ? {} : { last_token_usage: usage }) },
  } };
}

async function loadRecords(records: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), 'tokenleak-codex-regression-'));
  try {
    writeFileSync(join(dir, 'session.jsonl'), records.map((r) => JSON.stringify(r)).join('\n'));
    return await new CodexProvider(dir).load(CURRENT_RANGE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Codex accounting regressions', () => {
  const modern = (id: string, input = 1000, timestamp = '2026-03-12T10:01:00Z') => ({
    type: 'token_usage_record', timestamp, payload: { turn_id: 'turn-1', response_id: id,
      usage: { input_tokens: input, output_tokens: 100, cached_input_tokens: 200, cache_write_input_tokens: 100 } },
  });
  const modernTurn = { ...turn('gpt-5.4'), payload: { model: 'gpt-5.4', turn_id: 'turn-1' } };

  it('reads response-scoped usage and partitions cache reads/writes without inflating totals', async () => {
    const data = await loadRecords([modernTurn, modern('r1')]);
    expect(data.events?.[0]).toMatchObject({ totalTokens: 1100, inputTokens: 700,
      cacheReadTokens: 200, cacheWriteTokens: 100, outputTokens: 100, responseId: 'r1', turnId: 'turn-1' });
  });

  it.each([false, true])('counts mirrored legacy and modern records once (modern first: %s)', async (modernFirst) => {
    const record = modern('r1');
    const notification = tokens(1000, 100, { cached: 200 });
    Object.assign(notification.payload.info.last_token_usage!, { cache_write_input_tokens: 100 });
    const pair = modernFirst ? [record, notification] : [notification, record];
    const data = await loadRecords([modernTurn, ...pair]);
    expect(data.totalTokens).toBe(1100);
    expect(data.events).toHaveLength(1);
    expect(data.events?.[0]?.responseId).toBe('r1');
  });

  it('deduplicates response IDs but keeps distinct responses with identical token counts', async () => {
    const data = await loadRecords([modernTurn, modern('r1'), modern('r1'), modern('r2')]);
    expect(data.totalTokens).toBe(2200);
    expect(data.events).toHaveLength(2);
  });

  it('does not discard legacy-only usage when a turn has partial modern coverage', async () => {
    const data = await loadRecords([modernTurn, modern('r1'), tokens(500, 50)]);
    expect(data.totalTokens).toBe(1650);
  });

  it('reconciles across the range boundary before assigning dates', async () => {
    const record = modern('r1', 1000, '2026-03-11T23:59:59Z');
    const notification = tokens(1000, 100, { cached: 200, timestamp: '2026-03-12T00:00:01Z' });
    Object.assign(notification.payload.info.last_token_usage!, { cache_write_input_tokens: 100 });
    const data = await loadRecords([modernTurn, record, notification]);
    expect(data.totalTokens).toBe(0);
  });

  it('does not replace an explicit model with agent instruction prose on resume', async () => {
    const data = await loadRecords([turn('gpt-5.5'), tokens(1000, 100),
      { type: 'session_meta', payload: { base_instructions: { text: 'You are Codex, based on GPT-5.' } } },
      tokens(2000, 200, { last: false })]);
    expect(data.totalTokens).toBe(2200);
    expect(data.daily[0]?.models.map((m) => m.model)).toEqual(['gpt-5.5']);
  });

  it('leaves missing model identity unknown and unpriced', async () => {
    const data = await loadRecords([tokens(1000, 100)]);
    expect(data.events?.[0]).toMatchObject({ model: 'unknown', costSource: 'unpriced', totalTokens: 1100 });
  });

  it('does not count repeated cumulative notifications as new responses', async () => {
    const data = await loadRecords([turn('gpt-5.4'), tokens(1000, 100),
      tokens(1000, 100, { timestamp: '2026-03-12T10:02:00Z' })]);
    expect(data.totalTokens).toBe(1100);
    expect(data.events).toHaveLength(1);
  });

  it('keeps a session-wide baseline across a model switch', async () => {
    const data = await loadRecords([turn('gpt-5.4'), tokens(1000, 100, { last: false }),
      turn('gpt-5.5'), tokens(2000, 200, { last: false })]);
    expect(data.totalTokens).toBe(2200);
    expect(data.events?.map((e) => e.totalTokens)).toEqual([1100, 1100]);
    expect(data.events?.map((e) => e.model)).toEqual(['gpt-5.4', 'gpt-5.5']);
  });

  it('handles a counter reset without dropping the new usage', async () => {
    const data = await loadRecords([turn('gpt-5.4'), tokens(1000, 100, { last: false }),
      tokens(200, 20, { last: false })]);
    expect(data.totalTokens).toBe(1320);
  });

  it('preserves baseline updates before the requested date range', async () => {
    const data = await loadRecords([turn('gpt-5.4'),
      tokens(1000, 100, { last: false, timestamp: '2026-03-11T10:01:00Z' }),
      tokens(2000, 200, { last: false })]);
    expect(data.totalTokens).toBe(1100);
  });

  it('retains equal per-response usage when the cumulative counter advances', async () => {
    const second = tokens(2000, 200);
    second.payload.info.last_token_usage = { input_tokens: 1000, output_tokens: 100, cached_input_tokens: 0 };
    const data = await loadRecords([turn('gpt-5.4'), tokens(1000, 100), second]);
    expect(data.totalTokens).toBe(2200);
    expect(data.events).toHaveLength(2);
  });

  it('ignores invalid negative token usage and empty notifications', async () => {
    const data = await loadRecords([turn('gpt-5.4'), tokens(-10, -1), tokens(0, 0), tokens(100, 10)]);
    expect(data.totalTokens).toBe(110);
    expect(data.events).toHaveLength(1);
  });

  it('includes archives and deduplicates overlapping copies by session identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenleak-codex-archive-'));
    try {
      const active = join(root, 'sessions');
      const archive = join(root, 'archived_sessions');
      mkdirSync(active); mkdirSync(archive);
      const shared = [{ type: 'session_meta', payload: { id: 'same-session' } }, turn('gpt-5.4'), tokens(1000, 100)];
      const serialize = (records: unknown[]) => records.map((r) => JSON.stringify(r)).join('\n');
      writeFileSync(join(active, 'original.jsonl'), serialize(shared));
      writeFileSync(join(archive, 'renamed.jsonl'), serialize([...shared,
        tokens(2000, 200, { last: false, timestamp: '2026-03-12T10:02:00Z' })]));
      writeFileSync(join(archive, 'other.jsonl'), serialize([
        { type: 'session_meta', payload: { id: 'other-session' } }, turn('gpt-5.4'), tokens(1000, 100)]));
      const data = await new CodexProvider(active, archive).load(CURRENT_RANGE);
      expect(data.totalTokens).toBe(3300);
      expect(data.events).toHaveLength(3);
      expect(await new CodexProvider(join(root, 'missing'), archive).isAvailable()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('CodexProvider', () => {
  // -- metadata -----------------------------------------------------------

  it('has correct name, displayName, and colors', () => {
    const provider = new CodexProvider(FIXTURES_DIR);
    expect(provider.name).toBe('codex');
    expect(provider.displayName).toBe('Codex');
    expect(provider.colors.primary).toBe('#10a37f');
    expect(provider.colors.secondary).toBe('#4ade80');
    expect(provider.colors.gradient).toEqual(['#10a37f', '#4ade80']);
  });

  // -- isAvailable --------------------------------------------------------

  it('returns true when sessions directory exists', async () => {
    const provider = new CodexProvider(FIXTURES_DIR);
    expect(await provider.isAvailable()).toBe(true);
  });

  it('returns false when sessions directory does not exist', async () => {
    const provider = new CodexProvider(NONEXISTENT_DIR);
    expect(await provider.isAvailable()).toBe(false);
  });

  it('isAvailable never throws', async () => {
    // Pass a path that is definitely invalid
    const provider = new CodexProvider('/\0invalid-path');
    const result = await provider.isAvailable();
    expect(typeof result).toBe('boolean');
  });

  // -- load: happy path ---------------------------------------------------

  it('loads and aggregates session data correctly', async () => {
    const provider = new CodexProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);

    expect(data.provider).toBe('codex');
    expect(data.displayName).toBe('Codex');

    // We have events on 2025-06-15, 2025-06-16, 2025-06-17
    expect(data.daily).toHaveLength(3);

    // Daily entries are sorted by date
    expect(data.daily[0]!.date).toBe('2025-06-15');
    expect(data.daily[1]!.date).toBe('2025-06-16');
    expect(data.daily[2]!.date).toBe('2025-06-17');

    // 2025-06-15: two o4-mini events (1200+500=1700) + (800+300=1100) = 2800 total
    const day1 = data.daily[0]!;
    expect(day1.inputTokens).toBe(2000); // 1200 + 800
    expect(day1.outputTokens).toBe(800); // 500 + 300
    expect(day1.totalTokens).toBe(2800);
    expect(day1.models).toHaveLength(1);
    expect(day1.models[0]!.model).toBe('o4-mini');

    // 2025-06-16: gpt-4o (2000+1000=3000) + o4-mini (500+200=700) = 3700
    const day2 = data.daily[1]!;
    expect(day2.totalTokens).toBe(3700);
    expect(day2.models).toHaveLength(2);

    // 2025-06-17: o3-mini (3000+1500=4500)
    const day3 = data.daily[2]!;
    expect(day3.totalTokens).toBe(4500);
    expect(day3.models).toHaveLength(1);
    expect(day3.models[0]!.model).toBe('o3-mini');

    // Totals
    expect(data.totalTokens).toBe(2800 + 3700 + 4500);
    expect(data.totalCost).toBeGreaterThan(0);
  });

  it('loads nested Codex sessions using token_count events', async () => {
    const provider = new CodexProvider(CURRENT_FIXTURES_DIR);
    const data = await provider.load(CURRENT_RANGE);

    expect(data.daily).toHaveLength(1);
    expect(data.daily[0]!.date).toBe('2026-03-12');
    expect(data.daily[0]!.models).toHaveLength(1);
    expect(data.daily[0]!.models[0]!.model).toBe('gpt-5.4');
    expect(data.daily[0]!.inputTokens).toBe(1800);
    expect(data.daily[0]!.outputTokens).toBe(380);
    expect(data.daily[0]!.cacheReadTokens).toBe(700);
    expect(data.daily[0]!.totalTokens).toBe(2880);
    expect(data.totalTokens).toBe(2880);
    expect(data.totalCost).toBeCloseTo(0.010375, 8);
    expect(data.events?.map((event) => event.prompt)).toEqual([
      'implement replay prompt capture for Codex',
      'show me the latest replay token delta',
    ]);
    expect(data.costCompleteness).toMatchObject({
      status: 'complete',
      totalTokens: 2880,
      pricedTokens: 2880,
      unpricedTokens: 0,
      unknownModels: [],
    });
    expect(data.warnings ?? []).not.toContainEqual(
      expect.objectContaining({ kind: 'unknown-pricing', file: 'gpt-5.4' }),
    );
  });

  it('truncates captured prompts before attaching them to usage events', async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), 'tokenleak-codex-'));
    try {
      const dayDir = join(sessionsDir, '2026', '03', '12');
      mkdirSync(dayDir, { recursive: true });
      const longPrompt = 'x'.repeat(2_500);
      const records = [
        { timestamp: '2026-03-12T10:00:01Z', type: 'turn_context', payload: { model: 'gpt-5.4' } },
        {
          timestamp: '2026-03-12T10:02:00Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: longPrompt, images: [], local_images: [], text_elements: [] },
        },
        {
          timestamp: '2026-03-12T10:05:00Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 1000,
                cached_input_tokens: 200,
                output_tokens: 150,
                total_tokens: 1150,
              },
            },
          },
        },
      ];
      writeFileSync(join(dayDir, 'session-long.jsonl'), records.map((r) => JSON.stringify(r)).join('\n'));

      const provider = new CodexProvider(sessionsDir);
      const data = await provider.load(CURRENT_RANGE);

      expect(data.events).toHaveLength(1);
      expect(data.events?.[0]?.prompt).toBe('x'.repeat(2_000));
    } finally {
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  // -- load: empty directory ----------------------------------------------

  it('returns empty data when directory has no JSONL files', async () => {
    // The __fixtures__ dir has .jsonl files at root, but those are the
    // old splitter test fixtures, not in a codex sessions dir.
    // Let's use a dedicated empty dir instead.
    const emptyProvider = new CodexProvider(EMPTY_DIR);
    const data = await emptyProvider.load(FULL_RANGE);

    expect(data.daily).toEqual([]);
    expect(data.totalTokens).toBe(0);
    expect(data.totalCost).toBe(0);
  });

  // -- load: date filtering -----------------------------------------------

  it('filters events by date range', async () => {
    const provider = new CodexProvider(FIXTURES_DIR);

    // Only include June 15
    const narrowRange: DateRange = {
      since: '2025-06-15',
      until: '2025-06-15',
    };
    const data = await provider.load(narrowRange);

    expect(data.daily).toHaveLength(1);
    expect(data.daily[0]!.date).toBe('2025-06-15');
    expect(data.daily[0]!.totalTokens).toBe(2800);
  });

  it('returns empty data when no events match the date range', async () => {
    const provider = new CodexProvider(FIXTURES_DIR);
    const outOfRange: DateRange = {
      since: '2024-01-01',
      until: '2024-01-31',
    };
    const data = await provider.load(outOfRange);

    expect(data.daily).toEqual([]);
    expect(data.totalTokens).toBe(0);
  });

  // -- model normalization ------------------------------------------------

  it('normalizes model names by stripping date suffixes', async () => {
    const provider = new CodexProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);

    const allModels = data.daily.flatMap((d) =>
      d.models.map((m) => m.model),
    );

    // o4-mini-2025-04-16 -> o4-mini
    expect(allModels).toContain('o4-mini');
    // o3-mini-2025-01-31 -> o3-mini
    expect(allModels).toContain('o3-mini');
    // gpt-4o stays gpt-4o (no date suffix)
    expect(allModels).toContain('gpt-4o');

    // No raw suffixed names
    expect(allModels).not.toContain('o4-mini-2025-04-16');
    expect(allModels).not.toContain('o3-mini-2025-01-31');
  });

  // -- session file parsing: skips non-response events --------------------

  it('skips non-response event types in session files', async () => {
    const provider = new CodexProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);

    // session-001.jsonl has session.start and session.end events
    // These should be skipped; only "response" events counted
    // Total response events: 5 across both files
    // If non-response events were counted, totals would differ
    const totalInput = data.daily.reduce(
      (s, d) => s + d.inputTokens,
      0,
    );
    // 1200 + 800 + 2000 + 500 + 3000 = 7500
    expect(totalInput).toBe(7500);
  });

  // -- cost estimation ----------------------------------------------------

  it('calculates costs using the pricing table', async () => {
    const provider = new CodexProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);

    // o4-mini pricing: input=1.10/M, output=4.40/M
    // Day 1 o4-mini: 2000 input, 800 output
    // cost = (2000/1M)*1.10 + (800/1M)*4.40 = 0.0022 + 0.00352 = 0.00572
    const day1 = data.daily[0]!;
    expect(day1.cost).toBeCloseTo(0.00572, 5);
  });
});
