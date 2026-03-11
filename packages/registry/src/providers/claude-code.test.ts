import { describe, expect, it } from 'bun:test';
import { join } from 'path';
import { ClaudeCodeProvider } from './claude-code';
import type { DateRange } from '@tokenleak/core';
import { estimateCost } from '../models/cost';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__');

/** Range that includes all fixture data (June 2025). */
const FULL_RANGE: DateRange = { since: '2025-06-01', until: '2025-06-30' };

describe('ClaudeCodeProvider', () => {
  describe('metadata', () => {
    it('has correct name, displayName, and colors', () => {
      const provider = new ClaudeCodeProvider('/nonexistent');
      expect(provider.name).toBe('claude-code');
      expect(provider.displayName).toBe('Claude Code');
      expect(provider.colors).toEqual({
        primary: '#ff6b35',
        secondary: '#ffa366',
        gradient: ['#ff6b35', '#ffa366'],
      });
    });
  });

  describe('isAvailable', () => {
    it('returns false for a missing directory without throwing', async () => {
      const provider = new ClaudeCodeProvider('/nonexistent/path/that/does/not/exist');
      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });

    it('returns true when the directory exists', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code'));
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('load — happy path', () => {
    it('aggregates multiple days of data from multiple projects', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code'));
      const data = await provider.load(FULL_RANGE);

      expect(data.provider).toBe('claude-code');
      expect(data.displayName).toBe('Claude Code');

      // Fixture has data on 2025-06-15, 2025-06-16, 2025-06-17
      expect(data.daily).toHaveLength(3);
      expect(data.daily.map((d) => d.date)).toEqual([
        '2025-06-15',
        '2025-06-16',
        '2025-06-17',
      ]);

      // 2025-06-15: three assistant records (two from conv-001, one from conv-002)
      // All use claude-sonnet-4 (after normalization)
      const day1 = data.daily[0]!;
      expect(day1.inputTokens).toBe(1500 + 500 + 1000);
      expect(day1.outputTokens).toBe(800 + 300 + 600);
      expect(day1.cacheReadTokens).toBe(200 + 50 + 100);
      expect(day1.cacheWriteTokens).toBe(100 + 0 + 50);
      expect(day1.models).toHaveLength(1); // all claude-sonnet-4

      // 2025-06-16: one record with claude-opus-4
      const day2 = data.daily[1]!;
      expect(day2.inputTokens).toBe(2000);
      expect(day2.outputTokens).toBe(1000);
      expect(day2.models).toHaveLength(1);
      expect(day2.models[0]!.model).toBe('claude-opus-4');

      // 2025-06-17: one record with claude-sonnet-4
      const day3 = data.daily[2]!;
      expect(day3.inputTokens).toBe(800);
      expect(day3.outputTokens).toBe(400);

      // Totals should sum up
      expect(data.totalTokens).toBe(
        data.daily.reduce((sum, d) => sum + d.totalTokens, 0),
      );
      expect(data.totalCost).toBeCloseTo(
        data.daily.reduce((sum, d) => sum + d.cost, 0),
        10,
      );
    });
  });

  describe('load — empty file', () => {
    it('returns empty daily array for a directory with only empty JSONL files', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code-empty'));
      const data = await provider.load(FULL_RANGE);

      expect(data.daily).toHaveLength(0);
      expect(data.totalTokens).toBe(0);
      expect(data.totalCost).toBe(0);
    });
  });

  describe('load — model normalization', () => {
    it('strips date suffix from model names', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code'));
      const data = await provider.load(FULL_RANGE);

      const allModels = data.daily.flatMap((d) => d.models.map((m) => m.model));
      // All models should be normalized (no date suffix)
      for (const model of allModels) {
        expect(model).not.toMatch(/-\d{8}$/);
      }
      expect(allModels).toContain('claude-sonnet-4');
      expect(allModels).toContain('claude-opus-4');
    });
  });

  describe('load — cost calculation', () => {
    it('computes correct cost for known models', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code'));
      const data = await provider.load(FULL_RANGE);

      // Check 2025-06-16 which has a single opus-4 record:
      // input=2000, output=1000, cacheRead=500, cacheWrite=200
      const day2 = data.daily.find((d) => d.date === '2025-06-16')!;
      const expectedCost = estimateCost(
        'claude-opus-4-20250514',
        2000,
        1000,
        500,
        200,
      );
      expect(day2.cost).toBeCloseTo(expectedCost, 10);
    });
  });

  describe('load — date filtering', () => {
    it('excludes data outside the date range', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code'));

      // Only include 2025-06-16
      const narrowRange: DateRange = { since: '2025-06-16', until: '2025-06-16' };
      const data = await provider.load(narrowRange);

      expect(data.daily).toHaveLength(1);
      expect(data.daily[0]!.date).toBe('2025-06-16');
    });

    it('returns empty when range has no matching data', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code'));

      const noDataRange: DateRange = { since: '2024-01-01', until: '2024-01-31' };
      const data = await provider.load(noDataRange);

      expect(data.daily).toHaveLength(0);
      expect(data.totalTokens).toBe(0);
    });
  });

  describe('load — records without usage field', () => {
    it('skips records that lack a usage field', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code-no-usage'));
      const data = await provider.load(FULL_RANGE);

      // All records in this fixture either lack usage or are not assistant type
      expect(data.daily).toHaveLength(0);
      expect(data.totalTokens).toBe(0);
    });
  });

  describe('load — multiple projects aggregated', () => {
    it('combines data from multiple project directories', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code'));
      const data = await provider.load(FULL_RANGE);

      // 2025-06-15 has records from both project-abc123 and project-def456
      const day1 = data.daily.find((d) => d.date === '2025-06-15')!;
      // project-abc123: input 1500+500=2000, project-def456: input 1000
      expect(day1.inputTokens).toBe(3000);
    });
  });
});
