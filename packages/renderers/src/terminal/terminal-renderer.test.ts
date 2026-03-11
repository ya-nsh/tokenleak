import { describe, expect, it } from 'bun:test';
import type {
  TokenleakOutput,
  RenderOptions,
  AggregatedStats,
  ProviderData,
  DailyUsage,
  DayOfWeekEntry,
  TopModelEntry,
} from '@tokenleak/core';
import { SCHEMA_VERSION } from '@tokenleak/core';
import { TerminalRenderer } from './terminal-renderer';

function createDayOfWeek(): DayOfWeekEntry[] {
  return [
    { day: 0, label: 'Sun', tokens: 500, cost: 0.01, count: 2 },
    { day: 1, label: 'Mon', tokens: 3000, cost: 0.05, count: 5 },
    { day: 2, label: 'Tue', tokens: 2500, cost: 0.04, count: 4 },
    { day: 3, label: 'Wed', tokens: 2000, cost: 0.03, count: 3 },
    { day: 4, label: 'Thu', tokens: 1500, cost: 0.02, count: 3 },
    { day: 5, label: 'Fri', tokens: 1000, cost: 0.015, count: 2 },
    { day: 6, label: 'Sat', tokens: 200, cost: 0.005, count: 1 },
  ];
}

function createTopModels(): TopModelEntry[] {
  return [
    { model: 'claude-3.5-sonnet', tokens: 8000, cost: 0.10, percentage: 60 },
    { model: 'claude-3-opus', tokens: 4000, cost: 0.08, percentage: 30 },
    { model: 'gpt-4o', tokens: 1000, cost: 0.02, percentage: 10 },
  ];
}

function createZeroedAggregatedStats(): AggregatedStats {
  return {
    currentStreak: 0,
    longestStreak: 0,
    rolling30dTokens: 0,
    rolling30dCost: 0,
    rolling7dTokens: 0,
    rolling7dCost: 0,
    peakDay: null,
    averageDailyTokens: 0,
    averageDailyCost: 0,
    cacheHitRate: 0,
    totalTokens: 0,
    totalCost: 0,
    totalDays: 0,
    activeDays: 0,
    dayOfWeek: [],
    topModels: [],
  };
}

function createPopulatedStats(): AggregatedStats {
  return {
    currentStreak: 5,
    longestStreak: 12,
    rolling30dTokens: 150000,
    rolling30dCost: 4.50,
    rolling7dTokens: 35000,
    rolling7dCost: 1.05,
    peakDay: { date: '2026-03-05', tokens: 12000 },
    averageDailyTokens: 5000,
    averageDailyCost: 0.15,
    cacheHitRate: 0.42,
    totalTokens: 150000,
    totalCost: 4.50,
    totalDays: 30,
    activeDays: 20,
    dayOfWeek: createDayOfWeek(),
    topModels: createTopModels(),
  };
}

function createDailyUsage(days: number): DailyUsage[] {
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

function createProvider(name: string, displayName: string, days: number): ProviderData {
  const daily = createDailyUsage(days);
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

function createMinimalOutput(overrides: Partial<TokenleakOutput> = {}): TokenleakOutput {
  return {
    schemaVersion: SCHEMA_VERSION,
    generated: '2026-03-11T00:00:00.000Z',
    dateRange: { since: '2026-01-01', until: '2026-03-11' },
    providers: [],
    aggregated: createZeroedAggregatedStats(),
    ...overrides,
  };
}

function createDefaultOptions(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    format: 'terminal',
    theme: 'dark',
    width: 80,
    showInsights: false,
    noColor: false,
    output: null,
    ...overrides,
  };
}

/**
 * Strips ANSI escape sequences to get the visible text length.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('TerminalRenderer', () => {
  const renderer = new TerminalRenderer();

  it('has format set to terminal', () => {
    expect(renderer.format).toBe('terminal');
  });

  describe('width 80 compliance', () => {
    it('no visible line exceeds 80 chars at width 80', async () => {
      const output = createMinimalOutput({
        providers: [createProvider('anthropic', 'Anthropic', 10)],
        aggregated: createPopulatedStats(),
      });
      const options = createDefaultOptions({ width: 80, noColor: true });
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
      const output = createMinimalOutput({
        providers: [createProvider('anthropic', 'Anthropic', 5)],
        aggregated: createPopulatedStats(),
      });
      const options = createDefaultOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).not.toContain('\x1b[');
    });
  });

  describe('oneliner', () => {
    it('renders oneliner when width is less than 40', async () => {
      const output = createMinimalOutput({
        providers: [createProvider('anthropic', 'Anthropic', 5)],
        aggregated: createPopulatedStats(),
      });
      const options = createDefaultOptions({ width: 30 });
      const result = await renderer.render(output, options);

      // Oneliner should be a single line
      expect(result.split('\n')).toHaveLength(1);
    });

    it('oneliner includes streak and tokens', async () => {
      const stats = createPopulatedStats();
      const output = createMinimalOutput({
        providers: [createProvider('anthropic', 'Anthropic', 5)],
        aggregated: stats,
      });
      const options = createDefaultOptions({ width: 30 });
      const result = await renderer.render(output, options);

      expect(result).toContain('5d streak');
      expect(result).toContain('tokens');
    });

    it('oneliner includes provider count', async () => {
      const output = createMinimalOutput({
        providers: [
          createProvider('anthropic', 'Anthropic', 3),
          createProvider('openai', 'OpenAI', 3),
        ],
        aggregated: createPopulatedStats(),
      });
      const options = createDefaultOptions({ width: 30 });
      const result = await renderer.render(output, options);

      expect(result).toContain('2 providers');
    });
  });

  describe('dashboard', () => {
    it('includes provider names', async () => {
      const output = createMinimalOutput({
        providers: [createProvider('anthropic', 'Anthropic', 5)],
        aggregated: createPopulatedStats(),
      });
      const options = createDefaultOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Anthropic');
    });

    it('handles empty providers without errors', async () => {
      const output = createMinimalOutput({ providers: [] });
      const options = createDefaultOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('No provider data available');
    });

    it('includes dividers between multiple providers', async () => {
      const output = createMinimalOutput({
        providers: [
          createProvider('anthropic', 'Anthropic', 5),
          createProvider('openai', 'OpenAI', 5),
        ],
        aggregated: createPopulatedStats(),
      });
      const options = createDefaultOptions({ noColor: true });
      const result = await renderer.render(output, options);

      // Divider is a line of ─ characters
      expect(result).toContain('\u2500'.repeat(80));
      expect(result).toContain('Anthropic');
      expect(result).toContain('OpenAI');
    });

    it('shows streak count in stats section', async () => {
      const stats = createPopulatedStats();
      const output = createMinimalOutput({
        providers: [createProvider('anthropic', 'Anthropic', 5)],
        aggregated: stats,
      });
      const options = createDefaultOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Current Streak');
      expect(result).toContain('5d');
    });

    it('contains heatmap section', async () => {
      const output = createMinimalOutput({
        providers: [createProvider('anthropic', 'Anthropic', 10)],
        aggregated: createPopulatedStats(),
      });
      const options = createDefaultOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Heatmap');
    });

    it('shows day of week breakdown when data exists', async () => {
      const output = createMinimalOutput({
        providers: [createProvider('anthropic', 'Anthropic', 5)],
        aggregated: createPopulatedStats(),
      });
      const options = createDefaultOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Day of Week');
      expect(result).toContain('Mon');
    });

    it('shows top models when data exists', async () => {
      const output = createMinimalOutput({
        providers: [createProvider('anthropic', 'Anthropic', 5)],
        aggregated: createPopulatedStats(),
      });
      const options = createDefaultOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Top Models');
      expect(result).toContain('claude-3.5-sonnet');
    });

    it('shows insights when showInsights is true and stats warrant them', async () => {
      const stats = createPopulatedStats();
      stats.currentStreak = 10; // > 7 triggers insight
      const output = createMinimalOutput({
        providers: [createProvider('anthropic', 'Anthropic', 5)],
        aggregated: stats,
      });
      const options = createDefaultOptions({ noColor: true, showInsights: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Insights');
      expect(result).toContain('10-day coding streak');
    });

    it('shows overall section for multiple providers', async () => {
      const output = createMinimalOutput({
        providers: [
          createProvider('anthropic', 'Anthropic', 5),
          createProvider('openai', 'OpenAI', 5),
        ],
        aggregated: createPopulatedStats(),
      });
      const options = createDefaultOptions({ noColor: true });
      const result = await renderer.render(output, options);

      expect(result).toContain('Overall');
    });
  });
});
