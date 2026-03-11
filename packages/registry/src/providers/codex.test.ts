import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import type { DateRange } from '@tokenleak/core';
import { CodexProvider } from './codex';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'codex', 'sessions');
const NONEXISTENT_DIR = join(import.meta.dir, '..', '__fixtures__', 'codex', 'does-not-exist');
const EMPTY_DIR = join(import.meta.dir, '..', '__fixtures__', 'codex-empty');

const FULL_RANGE: DateRange = { since: '2025-06-01', until: '2025-06-30' };

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

  // -- load: empty directory ----------------------------------------------

  it('returns empty data when directory has no JSONL files', async () => {
    // Create provider pointing at a dir with no .jsonl files
    const provider = new CodexProvider(
      join(import.meta.dir, '..', '__fixtures__'),
    );
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
