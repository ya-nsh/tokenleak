import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { ClaudeCodeProvider, extractUserPrompt } from './claude-code';
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
      expect(data.daily.map((d) => d.date)).toEqual(['2025-06-15', '2025-06-16', '2025-06-17']);

      // 2025-06-15: three assistant records (two from conv-001, one from conv-002)
      // All use claude-sonnet-4 (after normalization)
      const day1 = data.daily[0]!;
      expect(day1.inputTokens).toBe(1500 + 500 + 1000);
      expect(day1.outputTokens).toBe(800 + 300 + 600);
      expect(day1.cacheReadTokens).toBe(200 + 50 + 100);
      expect(day1.cacheWriteTokens).toBe(100 + 0 + 50);
      expect(day1.models).toHaveLength(1); // all claude-sonnet-4
      expect(day1.models[0]!.pricing).toEqual({
        input: 3,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      });

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
      expect(data.totalTokens).toBe(data.daily.reduce((sum, d) => sum + d.totalTokens, 0));
      expect(data.totalCost).toBeCloseTo(
        data.daily.reduce((sum, d) => sum + d.cost, 0),
        10,
      );
      expect(data.events?.[0]?.pricing).toEqual({
        input: 3,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      });
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
      const expectedCost = estimateCost('claude-opus-4-20250514', 2000, 1000, 500, 200);
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

  describe('load — current Claude snapshots', () => {
    it('keeps only the latest usage snapshot for a repeated assistant message id', async () => {
      const tempRoot = join(tmpdir(), `claude-code-dedupe-${Date.now()}`);
      const projectDir = join(tempRoot, 'project-a');
      const sessionFile = join(projectDir, 'session.jsonl');

      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        sessionFile,
        [
          JSON.stringify({
            type: 'assistant',
            timestamp: '2026-03-10T10:00:00.000Z',
            message: {
              id: 'msg-1',
              model: 'claude-sonnet-4-20250514',
              usage: {
                input_tokens: 100,
                output_tokens: 10,
                cache_read_input_tokens: 20,
                cache_creation_input_tokens: 5,
              },
            },
          }),
          JSON.stringify({
            type: 'assistant',
            timestamp: '2026-03-10T10:00:01.000Z',
            message: {
              id: 'msg-1',
              model: 'claude-sonnet-4-20250514',
              usage: {
                input_tokens: 100,
                output_tokens: 80,
                cache_read_input_tokens: 20,
                cache_creation_input_tokens: 5,
              },
            },
          }),
          JSON.stringify({
            type: 'assistant',
            timestamp: '2026-03-10T11:00:00.000Z',
            message: {
              id: 'msg-2',
              model: 'claude-haiku-4-5-20251001',
              usage: {
                input_tokens: 50,
                output_tokens: 25,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            },
          }),
          JSON.stringify({
            type: 'assistant',
            timestamp: '2026-03-10T11:30:00.000Z',
            message: {
              id: 'msg-synthetic',
              model: '<synthetic>',
              usage: {
                input_tokens: 0,
                output_tokens: 0,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            },
          }),
        ].join('\n'),
      );

      try {
        const provider = new ClaudeCodeProvider(tempRoot);
        const data = await provider.load({ since: '2026-03-10', until: '2026-03-10' });

        expect(data.daily).toHaveLength(1);
        expect(data.totalTokens).toBe(280);

        const day = data.daily[0]!;
        expect(day.inputTokens).toBe(150);
        expect(day.outputTokens).toBe(105);
        expect(day.cacheReadTokens).toBe(20);
        expect(day.cacheWriteTokens).toBe(5);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    });
  });

  describe('extractUserPrompt', () => {
    it('returns null for non-user records', () => {
      expect(extractUserPrompt({ type: 'assistant', message: { content: 'hi' } })).toBeNull();
      expect(extractUserPrompt({ type: 'system' })).toBeNull();
      expect(extractUserPrompt(null)).toBeNull();
      expect(extractUserPrompt('not an object')).toBeNull();
    });

    it('accepts legacy `type: "human"` (fixture schema)', () => {
      const rec = { type: 'human', message: { role: 'user', content: 'old schema' } };
      expect(extractUserPrompt(rec)).toBe('old schema');
    });

    it('accepts current `type: "user"` (live schema)', () => {
      const rec = { type: 'user', message: { role: 'user', content: 'new schema' } };
      expect(extractUserPrompt(rec)).toBe('new schema');
    });

    it('extracts text from content-block arrays', () => {
      const rec = {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'first line' },
            { type: 'text', text: 'second line' },
          ],
        },
      };
      expect(extractUserPrompt(rec)).toBe('first line\nsecond line');
    });

    it('returns null for tool-result arrays (no text blocks)', () => {
      const rec = {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'x', content: 'some output' }],
        },
      };
      expect(extractUserPrompt(rec)).toBeNull();
    });

    it('filters out non-external user messages', () => {
      const rec = {
        type: 'user',
        userType: 'synthetic',
        message: { content: 'should be ignored' },
      };
      expect(extractUserPrompt(rec)).toBeNull();
    });

    it('accepts messages with userType="external"', () => {
      const rec = {
        type: 'user',
        userType: 'external',
        message: { content: 'real prompt' },
      };
      expect(extractUserPrompt(rec)).toBe('real prompt');
    });

    it('accepts messages with no userType field (older schema)', () => {
      const rec = { type: 'user', message: { content: 'no userType' } };
      expect(extractUserPrompt(rec)).toBe('no userType');
    });

    it('trims surrounding whitespace', () => {
      const rec = { type: 'user', message: { content: '   hello   ' } };
      expect(extractUserPrompt(rec)).toBe('hello');
    });

    it('returns null for empty/whitespace-only content', () => {
      expect(extractUserPrompt({ type: 'user', message: { content: '' } })).toBeNull();
      expect(extractUserPrompt({ type: 'user', message: { content: '   \n  ' } })).toBeNull();
    });

    it('truncates very long prompts', () => {
      const longPrompt = 'x'.repeat(5_000);
      const result = extractUserPrompt({ type: 'user', message: { content: longPrompt } });
      expect(result?.length).toBe(2_000);
    });

    it('returns null for malformed records', () => {
      expect(extractUserPrompt({ type: 'user' })).toBeNull();
      expect(extractUserPrompt({ type: 'user', message: null })).toBeNull();
      expect(extractUserPrompt({ type: 'user', message: 'not an object' })).toBeNull();
      expect(extractUserPrompt({ type: 'user', message: {} })).toBeNull();
    });
  });

  describe('load — prompt capture', () => {
    it('attaches the preceding user prompt to each assistant UsageEvent', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code'));
      const data = await provider.load(FULL_RANGE);

      const eventsWithPrompts = (data.events ?? []).filter((e) => e.prompt);
      // The fixture has two human prompts in conv-001 preceding assistant messages.
      expect(eventsWithPrompts.length).toBeGreaterThanOrEqual(2);
      const prompts = eventsWithPrompts.map((e) => e.prompt).sort();
      expect(prompts).toContain('Hello');
      expect(prompts).toContain('Help me');
    });

    it('does not attach prompts when none precede the assistant message', async () => {
      const provider = new ClaudeCodeProvider(join(FIXTURES_DIR, 'claude-code'));
      const data = await provider.load(FULL_RANGE);

      // conv-002 has no user prompts in the fixture, so those assistant events
      // must have no prompt attached.
      const conv002Events = (data.events ?? []).filter((e) =>
        e.sessionId?.includes('conv-002'),
      );
      expect(conv002Events.length).toBeGreaterThan(0);
      for (const event of conv002Events) {
        expect(event.prompt).toBeUndefined();
      }
    });
  });

  describe('constructor', () => {
    it('uses CLAUDE_CONFIG_DIR when no base directory override is provided', async () => {
      const tempConfigDir = join(tmpdir(), `claude-config-${Date.now()}`);
      const projectsDir = join(tempConfigDir, 'projects', 'project-a');
      const sessionFile = join(projectsDir, 'session.jsonl');
      const previous = process.env['CLAUDE_CONFIG_DIR'];

      mkdirSync(projectsDir, { recursive: true });
      writeFileSync(
        sessionFile,
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-03-08T10:00:00.000Z',
          message: {
            id: 'env-msg-1',
            model: 'claude-opus-4-20250514',
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
          },
        }),
      );

      process.env['CLAUDE_CONFIG_DIR'] = tempConfigDir;

      try {
        const provider = new ClaudeCodeProvider();
        const data = await provider.load({ since: '2026-03-08', until: '2026-03-08' });
        expect(data.totalTokens).toBe(15);
      } finally {
        if (previous === undefined) {
          delete process.env['CLAUDE_CONFIG_DIR'];
        } else {
          process.env['CLAUDE_CONFIG_DIR'] = previous;
        }
        rmSync(tempConfigDir, { recursive: true, force: true });
      }
    });
  });
});
