import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DateRange } from '@tokenleak/core';
import { CursorProvider } from './cursor';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'cursor-cache');
const FULL_RANGE: DateRange = { since: '2026-03-10', until: '2026-03-12' };

describe('CursorProvider', () => {
  it('keeps unknown GPT tiers alongside Fast usage in the same model breakdown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cursor-mixed-tiers-'));
    try {
      writeFileSync(join(root, 'usage.csv'), [
        'Model,Cost,Date,Output Tokens,Cache Read,Input (w/o Cache Write),Input (w/ Cache Write)',
        'gpt-5.4-fast,,2026-03-10,100,0,1000,1000',
        'gpt-5.4,,2026-03-10,100,0,1000,1000',
      ].join('\n'));
      const data = await new CursorProvider(root).load(FULL_RANGE);
      expect(data.daily[0]?.models[0]?.serviceTiers).toEqual([
        { tier: 'fast', tokens: 1100, cost: 0.008, unpricedTokens: 0 },
        { tier: 'unknown', tokens: 1100, cost: 0.004, unpricedTokens: 0 },
      ]);
      expect(data.events?.[1]?.serviceTierSource).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads reordered headers and estimates known aliases while preserving reported zero costs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cursor-aliases-'));
    try {
      writeFileSync(join(root, 'usage.csv'), [
        '\uFEFF"Model",Cost,Date,Output Tokens,Cache Read,Input (w/o Cache Write),Input (w/ Cache Write)',
        'claude-4.5-opus-high,,2026-03-10,100,0,1000,1000',
        'claude-4.5-opus-high-thinking,,2026-03-10,100,0,1000,1000',
        'gpt-5.4-fast,,2026-03-10,100,0,1000,1000',
        'auto,$0.00,2026-03-10,100,0,1000,1000',
        'composer-1,$0.12,2026-03-10,100,0,1000,1000',
      ].join('\n'));
      const data = await new CursorProvider(root).load(FULL_RANGE);
      expect(data.events?.map((e) => e.model)).toEqual(['claude-opus-4-5', 'claude-opus-4-5', 'gpt-5.4', 'auto', 'composer-1']);
      expect(data.events?.[0]?.cost).toBeCloseTo(0.0075);
      expect(data.events?.[2]).toMatchObject({ serviceTier: 'fast', cost: 0.008 });
      expect(data.events?.[3]).toMatchObject({ costSource: 'provider-reported', cost: 0 });
      expect(data.events?.[4]).toMatchObject({ costSource: 'provider-reported', cost: 0.12 });
      expect(data.costCompleteness?.status).toBe('complete');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('has correct name, displayName, and colors', () => {
    const provider = new CursorProvider(FIXTURES_DIR);
    expect(provider.name).toBe('cursor');
    expect(provider.displayName).toBe('Cursor');
    expect(provider.colors).toEqual({
      primary: '#22c55e',
      secondary: '#86efac',
      gradient: ['#22c55e', '#86efac'],
    });
  });

  it('returns true when cursor cache exists', async () => {
    const provider = new CursorProvider(FIXTURES_DIR);
    expect(await provider.isAvailable()).toBe(true);
  });

  it('returns false when only archived cursor data exists', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'cursor-archive-only-'));
    mkdirSync(join(tempRoot, 'archive'));
    writeFileSync(
      join(tempRoot, 'archive', 'usage.archived.csv'),
      'Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n2026-03-10,chat,gpt-4o,false,10,10,0,5,15,$0.10\n',
    );

    try {
      const provider = new CursorProvider(tempRoot);
      expect(await provider.isAvailable()).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('loads both current and legacy cursor cache CSV files', async () => {
    const provider = new CursorProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);

    expect(data.provider).toBe('cursor');
    expect(data.displayName).toBe('Cursor');
    expect(data.daily).toHaveLength(3);

    const day1 = data.daily[0]!;
    expect(day1.date).toBe('2026-03-10');
    expect(day1.inputTokens).toBe(1000);
    expect(day1.outputTokens).toBe(300);
    expect(day1.cacheReadTokens).toBe(200);
    expect(day1.cacheWriteTokens).toBe(200);
    expect(day1.totalTokens).toBe(1700);
    expect(day1.cost).toBe(0.01);
    expect(day1.models[0]!.model).toBe('claude-sonnet-4');

    const day2 = data.daily[1]!;
    expect(day2.date).toBe('2026-03-11');
    expect(day2.totalTokens).toBe(950);
    expect(day2.models.map((model) => model.model)).toEqual(['gpt-4o', 'o4-mini']);
    expect(day2.cost).toBeCloseTo(0.0034375, 10);

    const day3 = data.daily[2]!;
    expect(day3.date).toBe('2026-03-12');
    expect(day3.totalTokens).toBe(30);
    expect(day3.cost).toBe(0);
    expect(day3.models[0]!.model).toBe('unknown-model');

    expect(data.totalTokens).toBe(2680);
    expect(data.totalCost).toBeCloseTo(0.0134375, 10);
  });

  it('filters events by date range', async () => {
    const provider = new CursorProvider(FIXTURES_DIR);
    const data = await provider.load({ since: '2026-03-11', until: '2026-03-11' });

    expect(data.daily).toHaveLength(1);
    expect(data.daily[0]!.date).toBe('2026-03-11');
    expect(data.totalTokens).toBe(950);
  });

  it('returns empty data for an empty cursor CSV file', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'cursor-empty-file-'));
    writeFileSync(join(tempRoot, 'usage.csv'), '');

    try {
      const provider = new CursorProvider(tempRoot);
      const data = await provider.load(FULL_RANGE);
      expect(data.daily).toEqual([]);
      expect(data.totalTokens).toBe(0);
      expect(data.totalCost).toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('returns empty data for a header-only cursor CSV file', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'cursor-header-only-'));
    writeFileSync(
      join(tempRoot, 'usage.csv'),
      'Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n',
    );

    try {
      const provider = new CursorProvider(tempRoot);
      const data = await provider.load(FULL_RANGE);
      expect(data.daily).toEqual([]);
      expect(data.totalTokens).toBe(0);
      expect(data.totalCost).toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('skips malformed cursor rows without throwing', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'cursor-malformed-'));
    writeFileSync(
      join(tempRoot, 'usage.csv'),
      [
        'Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost',
        '2026-03-10T12:34:56Z,chat,claude-sonnet-4-20250514,false,1200,1000,200,300,1700,$0.0100',
        '2026-03-11T06:00:00Z,chat,gpt-4o-2025-01-29,false,550,500',
      ].join('\n'),
    );

    try {
      const provider = new CursorProvider(tempRoot);
      const data = await provider.load(FULL_RANGE);
      expect(data.daily).toHaveLength(1);
      expect(data.daily[0]!.date).toBe('2026-03-10');
      expect(data.totalTokens).toBe(1700);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('ignores archived files and preserves account-specific session ids', async () => {
    const provider = new CursorProvider(FIXTURES_DIR);
    const data = await provider.load(FULL_RANGE);
    const sessionIds = new Set((data.events ?? []).map((event) => event.sessionId));

    expect(sessionIds).toContain('cursor-active-2026-03-10T12:34:56.000Z');
    expect(sessionIds).toContain('cursor-work-2026-03-11T12:00:00.000Z');
    expect(data.totalTokens).not.toBeGreaterThan(5000);
  });
});
