import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexProvider } from './codex';
import { aggregate, mergeProviderData, buildMoreStats } from '@tokenleak/core';

const range = { since: '2026-03-12', until: '2026-03-12' };
const timestamp = '2026-03-12T10:00:00Z';
const context = (tier = 'default') => ({ type: 'turn_context', timestamp,
  payload: { model: 'gpt-5.5', turn_id: 'turn-1', service_tier: tier, cwd: '/synthetic-project' } });
const usage = (input = 1000, output = 100, cached = 0) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: cached });
const modern = (id = 'r1', cached = 0) => ({ type: 'token_usage_record', timestamp,
  payload: { turn_id: 'turn-1', response_id: id, usage: usage(1000, 100, cached) } });
const notification = (input = 1000, output = 100, last = true) => ({ type: 'event_msg', timestamp,
  payload: { type: 'token_count', info: { total_token_usage: usage(input, output),
    ...(last ? { last_token_usage: usage(input, output) } : {}) } } });

async function load(records: unknown[], archived?: unknown[]) {
  const root = mkdtempSync(join(tmpdir(), 'tokenleak-review-'));
  try {
    const active = join(root, 'sessions'); const archive = join(root, 'archived_sessions');
    mkdirSync(active); mkdirSync(archive);
    const write = (dir: string, entries: unknown[]) => writeFileSync(join(dir, 'session.jsonl'),
      [{ type: 'session_meta', payload: { id: 'session-1' } }, ...entries].map((e) => JSON.stringify(e)).join('\n'));
    write(active, records);
    if (archived) write(archive, archived);
    return await new CodexProvider(active, archive).load(range);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('response-only usage followed by a cumulative-only update is counted once', async () => {
  const data = await load([context(), modern(), notification(2000, 200, false)]);
  expect(data.totalTokens).toBe(2200);
});

test.each([false, true])('overlapping archive copies reconcile with response records in either copy (%s)', async (modernInArchive) => {
  const prefix = [context(), notification()];
  const data = modernInArchive ? await load(prefix, [...prefix, modern()]) : await load([...prefix, modern()], prefix);
  expect(data.totalTokens).toBe(1100);
  expect(data.events![0]!.responseId).toBe('r1');
});

test('subtracts multiple unique responses from cumulative coverage and reprices the remainder', async () => {
  const data = await load([context(), modern('r1'), modern('r1'), modern('r2'), notification(3000, 300, false)]);
  expect(data.totalTokens).toBe(3300);
  expect(data.totalCost).toBeCloseTo(0.024, 8);
  expect(data.events!.map((event) => event.totalTokens)).toEqual([1100, 1100, 1100]);
});

test('does not subtract a delayed response already covered by a previous notification', async () => {
  const data = await load([context(), notification(), modern('r1'), modern('r2'), notification(3000, 300, false)]);
  expect(data.totalTokens).toBe(3300);
  expect(data.events).toHaveLength(3);
});

test('retains new usage when a counter reset excludes earlier response records', async () => {
  const data = await load([context(), modern(), notification(200, 20, false)]);
  expect(data.totalTokens).toBe(1320);
});

test('partitions cached coverage before pricing a cumulative remainder', async () => {
  const counter = notification(2000, 200, false);
  counter.payload.info.total_token_usage.cached_input_tokens = 800;
  const data = await load([context(), modern('r1', 800), counter]);
  expect(data.totalTokens).toBe(2200);
  expect(data.events![1]).toMatchObject({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 });
  expect(data.totalCost).toBeCloseTo(0.0124, 8);
});

test.each([false, true])('archive overlaps prefer a reconciled cumulative remainder (%s)', async (modernInArchive) => {
  const legacy = [context(), notification(2000, 200, false)];
  const mixed = [context(), modern(), notification(2000, 200, false)];
  const data = modernInArchive ? await load(legacy, mixed) : await load(mixed, legacy);
  expect(data.totalTokens).toBe(2200);
  expect(data.events).toHaveLength(2);
});

test('archive reconciliation happens before midnight range filtering', async () => {
  const record = { ...modern(), timestamp: '2026-03-11T23:59:59Z' };
  const counter = { ...notification(), timestamp: '2026-03-12T00:00:01Z' };
  const data = await load([context(), counter], [context(), record, counter]);
  expect(data.totalTokens).toBe(0);
});

test('cache ROI keeps both standard and Fast rates for a model on the same day', async () => {
  const data = await load([context(), modern('r1', 800), context('fast'), modern('r2', 800)]);
  const roi = buildMoreStats([data], range).cacheRoi!;
  expect(roi.byProject[0]!.readSavings).toBeCloseTo(0.0126, 8);
  expect(roi.summary.readSavings).toBeCloseTo(0.0126, 8);
  expect(roi.byProvider[0]!.readSavings).toBeCloseTo(0.0126, 8);
  expect(roi.byModel[0]!.readSavings).toBeCloseTo(0.0126, 8);
});

test('cache ROI retains daily totals when event coverage is partial or absent', async () => {
  const data = await load([context(), modern('r1', 800), modern('r2', 800)]);
  data.events = data.events!.slice(0, 1);
  expect(buildMoreStats([data], range).cacheRoi!.summary.readSavings).toBeCloseTo(0.0072, 8);
  data.events = [];
  expect(buildMoreStats([data], range).cacheRoi!.summary.readSavings).toBeCloseTo(0.0072, 8);
});

test('mixed providers retain unknown-tier tokens alongside Fast tokens', async () => {
  const data = await load([context('fast'), modern()]);
  const other = structuredClone(data);
  other.provider = 'openclaw'; other.displayName = 'OpenClaw'; other.events = [];
  for (const day of other.daily) for (const model of day.models) delete model.serviceTiers;
  const stats = aggregate(mergeProviderData([data, other]), range.until, range);
  const model = stats.allModels![0]!;
  expect(model.serviceTiers!.reduce((sum, tier) => sum + tier.tokens, 0)).toBe(model.tokens);
  expect(model.serviceTiers!.map((tier) => tier.tier)).toEqual(['fast', 'unknown']);
  expect(data.daily[0]!.models[0]!.serviceTiers).toHaveLength(1);
});

test.each([false, true])('cross-day aggregation fills missing tiers in either order (%s)', async (unknownFirst) => {
  const data = await load([context('fast'), modern()]);
  const known = data.daily[0]!;
  const unknown = structuredClone(known);
  unknown.date = '2026-03-11';
  delete unknown.models[0]!.serviceTiers;
  const stats = aggregate(unknownFirst ? [unknown, known] : [known, unknown], range.until);
  expect(stats.allModels![0]!.serviceTiers).toEqual([
    { tier: 'fast', tokens: 1100, cost: 0.02, unpricedTokens: 0 },
    { tier: 'unknown', tokens: 1100, cost: 0.02, unpricedTokens: 0 },
  ]);
});

test('turn-level tier metadata wins over resumed session defaults without a turn ID', async () => {
  const turn = context('default'); delete (turn.payload as { turn_id?: string }).turn_id;
  const data = await load([turn, { type: 'session_meta', payload: { service_tier: 'fast' } }, notification()]);
  expect(data.events![0]!.serviceTier).toBe('default');
});
