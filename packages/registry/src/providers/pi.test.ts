import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { DateRange } from '@tokenleak/core';
import { PiProvider } from './pi';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'pi');
const FULL_RANGE: DateRange = { since: '2026-03-10', until: '2026-03-12' };

describe('PiProvider', () => {
  it('has correct name, displayName, and colors', () => {
    const provider = new PiProvider(FIXTURES_DIR);
    expect(provider.name).toBe('pi');
    expect(provider.displayName).toBe('Pi');
    expect(provider.colors).toEqual({
      primary: '#2563eb',
      secondary: '#7dd3fc',
      gradient: ['#2563eb', '#7dd3fc'],
    });
  });

  it('returns true when the import directory contains JSONL files', async () => {
    const provider = new PiProvider(FIXTURES_DIR);
    expect(await provider.isAvailable()).toBe(true);
  });

  it('returns false when the import directory does not exist', async () => {
    const provider = new PiProvider(join(FIXTURES_DIR, 'missing'));
    expect(await provider.isAvailable()).toBe(false);
  });

  it('loads and aggregates imported Pi usage events', async () => {
    const provider = new PiProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);

    expect(data.provider).toBe('pi');
    expect(data.displayName).toBe('Pi');
    expect(data.daily).toHaveLength(3);

    const day1 = data.daily[0]!;
    expect(day1.date).toBe('2026-03-10');
    expect(day1.inputTokens).toBe(1500);
    expect(day1.outputTokens).toBe(300);
    expect(day1.cacheReadTokens).toBe(100);
    expect(day1.totalTokens).toBe(1900);
    expect(day1.cost).toBeCloseTo(0.63, 6);
    expect(day1.models).toHaveLength(1);
    expect(day1.models[0]!.model).toBe('pi-3.1-preview');

    const day2 = data.daily[1]!;
    expect(day2.date).toBe('2026-03-11');
    expect(day2.inputTokens).toBe(800);
    expect(day2.outputTokens).toBe(300);
    expect(day2.cacheWriteTokens).toBe(50);
    expect(day2.totalTokens).toBe(1150);
    expect(day2.cost).toBeCloseTo(0.35, 6);
    expect(day2.models[0]!.model).toBe('pi-3.0');

    const day3 = data.daily[2]!;
    expect(day3.date).toBe('2026-03-12');
    expect(day3.totalTokens).toBe(180);
    expect(day3.cost).toBe(0);
    expect(day3.models[0]!.model).toBe('pi experimental');

    expect(data.totalTokens).toBe(3230);
    expect(data.totalCost).toBeCloseTo(0.98, 6);
    expect(data.events).toHaveLength(4);
  });

  it('filters imported events by date range', async () => {
    const provider = new PiProvider(FIXTURES_DIR);
    const data = await provider.load({ since: '2026-03-11', until: '2026-03-11' });

    expect(data.daily).toHaveLength(1);
    expect(data.daily[0]!.date).toBe('2026-03-11');
    expect(data.totalTokens).toBe(1150);
  });

  it('preserves session and project metadata on events', async () => {
    const provider = new PiProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);
    const firstEvent = data.events?.[0];

    expect(firstEvent?.sessionId).toBe('session-001');
    expect(firstEvent?.projectId).toBe('personal-assistant');
  });
});
