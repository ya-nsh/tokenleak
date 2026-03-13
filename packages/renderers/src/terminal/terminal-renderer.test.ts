import { describe, expect, it } from 'bun:test';
import type {
  ProviderData,
  DailyUsage,
} from '@tokenleak/core';
import { TerminalRenderer } from './terminal-renderer';
import {
  createOutput,
  createPopulatedStats,
  createRenderOptions,
  createZeroedStats,
} from '../__test-fixtures__';

/**
 * Generates a sequence of DailyUsage entries starting from 2026-03-01.
 * Kept local because it differs from the single-day factory in shared fixtures.
 */
function createDailyUsageSequence(days: number): DailyUsage[] {
  const daily: DailyUsage[] = [];
  const baseDate = new Date('2026-03-01');
  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    daily.push({
      date: dateStr,
      inputTokens: 1000 + i * 100,
      outputTokens: 500 + i * 50,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      totalTokens: 1800 + i * 150,
      cost: 0.05 + i * 0.01,
      models: [
        {
          model: 'claude-3.5-sonnet',
          inputTokens: 1000 + i * 100,
          outputTokens: 500 + i * 50,
          cacheReadTokens: 200,
          cacheWriteTokens: 100,
          totalTokens: 1800 + i * 150,
          cost: 0.05 + i * 0.01,
        },
      ],
    });
  }
  return daily;
}

/**
 * Creates a provider with a generated sequence of daily usage.
 * Kept local because the terminal tests need the days-count variant.
 */
function createTerminalProvider(name: string, displayName: string, days: number): ProviderData {
  const daily = createDailyUsageSequence(days);
  const totalTokens = daily.reduce((sum, d) => sum + d.totalTokens, 0);
  const totalCost = daily.reduce((sum, d) => sum + d.cost, 0);
  return {
    provider: name,
    displayName,
    daily,
    totalTokens,
    totalCost,
    colors: {
      primary: '#d97706',
      secondary: '#fbbf24',
      gradient: ['#d97706', '#fbbf24'],
    },
  };
}

function createTerminalOutput(
  overrides: Parameters<typeof createOutput>[0] = {},
) {
  return createOutput({
    providers: [],
    aggregated: createZeroedStats(),
    ...overrides,
  });
}

function createTerminalOptions(
  overrides: Parameters<typeof createRenderOptions>[0] = {},
) {
  return createRenderOptions({
    format: 'terminal',
    width: 80,
    showInsights: false,
    ...overrides,
  });
}

/**
 * Strips ANSI escape sequences to get the visible text length.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Terminal-specific populated stats using claude-3.5-sonnet as top model */
function createTerminalPopulatedStats() {
  return createPopulatedStats({
    currentStreak: 5,
    longestStreak: 12,
    rolling30dTokens: 150000,
    rolling30dCost: 4.50,
    rolling7dTokens: 35000,
    rolling7dCost: 1.05,
    peakDay: { date: '2026-03-05', tokens: 12000 },
    averageDailyTokens: 5000,
    averageDailyCost: 0.15,
    totalTokens: 150000,
    totalInputTokens: 90000,
    totalOutputTokens: 45000,
    totalCost: 4.50,
    totalDays: 30,
    activeDays: 20,
    dayOfWeek: [
      { day: 0, label: 'Sun', tokens: 500, cost: 0.01, count: 2 },
      { day: 1, label: 'Mon', tokens: 3000, cost: 0.05, count: 5 },
      { day: 2, label: 'Tue', tokens: 2500, cost: 0.04, count: 4 },
      { day: 3, label: 'Wed', tokens: 2000, cost: 0.03, count: 3 },
      { day: 4, label: 'Thu', tokens: 1500, cost: 0.02, count: 3 },
      { day: 5, label: 'Fri', tokens: 1000, cost: 0.015, count: 2 },
      { day: 6, label: 'Sat', tokens: 200, cost: 0.005, count: 1 },
    ],
    topModels: [
      { model: 'claude-3.5-sonnet', tokens: 8000, cost: 0.10, percentage: 60 },
      { model: 'claude-3-opus', tokens: 4000, cost: 0.08, percentage: 30 },
      { model: 'gpt-4o', tokens: 1000, cost: 0.02, percentage: 10 },
    ],
    rolling30dTopModel: 'claude-3.5-sonnet',
  });
}

describe('TerminalRenderer', () => {
  const renderer = new TerminalRenderer();

  it('has format set to terminal', () => {
    expect(renderer.format).toBe('terminal');
  });

  describe('width 80 compliance', () => {
    it('no visible line exceeds 80 chars at width 80', async () => {
      const output = createTerminalOutput({
        providers: [createTerminalProvider('anthropic', 'Anthropic', 10)],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ width: 80, noColor: true });
      const result = await renderer.render(output, options);
      const lines = result.split('\n');

      for (const line of lines) {
        const visible = stripAnsi(line);
        expect(visible.length).toBeLessThanOrEqual(80);
      }
    });
  });

  describe('noColor', () => {
    it('produces no ANSI escape codes when noColor is true', async () => {
      const output = createTerminalOutput({
        providers: [createTerminalProvider('anthropic', 'Anthropic', 5)],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).not.toContain('\x1b[');
    });
  });

  describe('oneliner', () => {
    it('renders oneliner when width is less than 40', async () => {
      const output = createTerminalOutput({
        providers: [createTerminalProvider('anthropic', 'Anthropic', 5)],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ width: 30 });
      const result = await renderer.render(output, options);

      // Oneliner should be a single line
      expect(result.split('\n')).toHaveLength(1);
    });

    it('oneliner includes streak and tokens', async () => {
      const stats = createTerminalPopulatedStats();
      const output = createTerminalOutput({
        providers: [createTerminalProvider('anthropic', 'Anthropic', 5)],
        aggregated: stats,
      });
      const options = createTerminalOptions({ width: 30 });
      const result = await renderer.render(output, options);

      expect(result).toContain('5d streak');
      expect(result).toContain('tokens');
    });

    it('oneliner includes provider count', async () => {
      const output = createTerminalOutput({
        providers: [
          createTerminalProvider('anthropic', 'Anthropic', 3),
          createTerminalProvider('openai', 'OpenAI', 3),
        ],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ width: 30 });
      const result = await renderer.render(output, options);

      expect(result).toContain('2 providers');
    });
  });

  describe('dashboard', () => {
    it('includes provider names', async () => {
      const output = createTerminalOutput({
        providers: [createTerminalProvider('anthropic', 'Anthropic', 5)],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Anthropic');
    });

    it('handles empty providers without errors', async () => {
      const output = createTerminalOutput({ providers: [] });
      const options = createTerminalOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('No provider data available');
    });

    it('includes dividers between multiple providers', async () => {
      const output = createTerminalOutput({
        providers: [
          createTerminalProvider('anthropic', 'Anthropic', 5),
          createTerminalProvider('openai', 'OpenAI', 5),
        ],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ noColor: true });
      const result = await renderer.render(output, options);

      // Divider is a line of ─ characters
      expect(result).toContain('\u2500'.repeat(80));
      expect(result).toContain('Anthropic');
      expect(result).toContain('OpenAI');
    });

    it('shows streak count in stats section', async () => {
      const stats = createTerminalPopulatedStats();
      const output = createTerminalOutput({
        providers: [createTerminalProvider('anthropic', 'Anthropic', 5)],
        aggregated: stats,
      });
      const options = createTerminalOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Current Streak');
      expect(result).toContain('5d');
    });

    it('contains heatmap section', async () => {
      const output = createTerminalOutput({
        providers: [createTerminalProvider('anthropic', 'Anthropic', 10)],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Heatmap');
    });

    it('shows day of week breakdown when data exists', async () => {
      const output = createTerminalOutput({
        providers: [createTerminalProvider('anthropic', 'Anthropic', 5)],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Day of Week');
      expect(result).toContain('Mon');
    });

    it('shows top models when data exists', async () => {
      const output = createTerminalOutput({
        providers: [createTerminalProvider('anthropic', 'Anthropic', 5)],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Top Models');
      expect(result).toContain('claude-3.5-sonnet');
    });

    it('uses per-provider stats instead of repeating overall totals in each section', async () => {
      const output = createTerminalOutput({
        providers: [
          createTerminalProvider('anthropic', 'Anthropic', 5),
          createTerminalProvider('openai', 'OpenAI', 2),
        ],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Total Tokens         11K');
      expect(result).toContain('Total Tokens         4K');
    });

    it('shows insights when showInsights is true and stats warrant them', async () => {
      const stats = createTerminalPopulatedStats();
      stats.currentStreak = 10; // > 7 triggers insight
      const output = createTerminalOutput({
        providers: [createTerminalProvider('anthropic', 'Anthropic', 10)],
        aggregated: stats,
      });
      const options = createTerminalOptions({ noColor: true, showInsights: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Insights');
      expect(result).toContain('10-day coding streak');
    });

    it('shows overall section for multiple providers', async () => {
      const output = createTerminalOutput({
        providers: [
          createTerminalProvider('anthropic', 'Anthropic', 5),
          createTerminalProvider('openai', 'OpenAI', 5),
        ],
        aggregated: createTerminalPopulatedStats(),
      });
      const options = createTerminalOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Overall');
    });
  });
});
