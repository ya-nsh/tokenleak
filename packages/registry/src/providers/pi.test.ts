import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DateRange } from '@tokenleak/core';
import { PiProvider } from './pi';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'pi', 'agent');
const FULL_RANGE: DateRange = { since: '2026-03-10', until: '2026-03-11' };

describe('PiProvider', () => {
  it('has correct name, displayName, and colors', () => {
    const provider = new PiProvider('/nonexistent');
    expect(provider.name).toBe('pi');
    expect(provider.displayName).toBe('Pi');
    expect(provider.colors).toEqual({
      primary: '#0ea5e9',
      secondary: '#67e8f9',
      gradient: ['#0ea5e9', '#67e8f9'],
    });
  });

  it('returns false when the agent directory does not exist', async () => {
    const provider = new PiProvider('/nonexistent/path/that/does/not/exist');
    expect(await provider.isAvailable()).toBe(false);
  });

  it('returns true when the sessions directory exists and contains session files', async () => {
    const provider = new PiProvider(FIXTURES_DIR);
    expect(await provider.isAvailable()).toBe(true);
  });

  it('returns true when the sessions directory exists even if it is empty', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pi-empty-'));
    mkdirSync(join(tempRoot, 'sessions'));

    try {
      const provider = new PiProvider(tempRoot);
      expect(await provider.isAvailable()).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('loads assistant usage from pi-mono session JSONL files', async () => {
    const provider = new PiProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);

    expect(data.provider).toBe('pi');
    expect(data.displayName).toBe('Pi');
    expect(data.daily).toHaveLength(2);

    const day1 = data.daily[0]!;
    expect(day1.date).toBe('2026-03-10');
    expect(day1.inputTokens).toBe(1000);
    expect(day1.outputTokens).toBe(200);
    expect(day1.cacheReadTokens).toBe(100);
    expect(day1.cacheWriteTokens).toBe(50);
    expect(day1.totalTokens).toBe(1350);
    expect(day1.cost).toBeCloseTo(0.0062175, 10);
    expect(day1.models).toHaveLength(1);
    expect(day1.models[0]!.model).toBe('claude-sonnet-4');

    const day2 = data.daily[1]!;
    expect(day2.date).toBe('2026-03-11');
    expect(day2.totalTokens).toBe(1100);
    expect(day2.cost).toBeCloseTo(0.0035475, 10);
    expect(day2.models).toHaveLength(2);
    expect(day2.models.map((model) => model.model).sort()).toEqual(['gpt-4o', 'o4-mini']);

    expect(data.totalTokens).toBe(2450);
    expect(data.totalCost).toBeCloseTo(0.009765, 10);
  });

  it('filters events by date range', async () => {
    const provider = new PiProvider(FIXTURES_DIR);
    const data = await provider.load({ since: '2026-03-11', until: '2026-03-11' });

    expect(data.daily).toHaveLength(1);
    expect(data.daily[0]!.date).toBe('2026-03-11');
    expect(data.totalTokens).toBe(1100);
  });

  it('normalizes dashed-date model suffixes from pi session logs', async () => {
    const provider = new PiProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);

    const allModels = data.daily.flatMap((day) => day.models.map((model) => model.model));
    expect(allModels).toContain('o4-mini');
    expect(allModels).not.toContain('o4-mini-2025-04-16');
  });

  it('preserves session file path and project cwd on events', async () => {
    const provider = new PiProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);
    const firstEvent = data.events?.[0];

    expect(firstEvent?.sessionId).toBe('--Users-test-alpha--/2026-03-10_sess-alpha.jsonl');
    expect(firstEvent?.projectId).toBe('/Users/test/alpha');
  });
});
