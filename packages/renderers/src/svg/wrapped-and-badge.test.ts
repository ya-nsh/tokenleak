import { describe, expect, it } from 'bun:test';
import type {
  TokenleakOutput,
  AggregatedStats,
  ProviderData,
  DailyUsage,
  DayOfWeekEntry,
  TopModelEntry,
} from '@tokenleak/core';
import { SCHEMA_VERSION } from '@tokenleak/core';
import { renderWrappedCard } from './wrapped';
import { renderBadge } from './badge';

function createDayOfWeek(): DayOfWeekEntry[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.map((label, i) => ({
    day: i,
    label,
    tokens: (i + 1) * 1000,
    cost: (i + 1) * 0.01,
    count: i + 1,
  }));
}

function createTopModels(): TopModelEntry[] {
  return [
    { model: 'claude-3-opus', tokens: 50000, cost: 1.5, percentage: 50 },
  ];
}

function createPopulatedStats(overrides: Partial<AggregatedStats> = {}): AggregatedStats {
  return {
    currentStreak: 7,
    longestStreak: 14,
    rolling30dTokens: 80000,
    rolling30dCost: 3.2,
    rolling7dTokens: 20000,
    rolling7dCost: 0.8,
    peakDay: { date: '2026-03-01', tokens: 8000 },
    averageDailyTokens: 2500,
    averageDailyCost: 0.1,
    cacheHitRate: 0.42,
    totalTokens: 100000,
    totalCost: 4.0,
    totalDays: 40,
    activeDays: 30,
    dayOfWeek: createDayOfWeek(),
    topModels: createTopModels(),
    ...overrides,
  };
}

function createDailyUsage(date: string, totalTokens: number): DailyUsage {
  return {
    date,
    inputTokens: Math.floor(totalTokens * 0.6),
    outputTokens: Math.floor(totalTokens * 0.3),
    cacheReadTokens: Math.floor(totalTokens * 0.08),
    cacheWriteTokens: Math.floor(totalTokens * 0.02),
    totalTokens,
    cost: totalTokens * 0.00004,
    models: [
      {
        model: 'claude-3-opus',
        inputTokens: Math.floor(totalTokens * 0.6),
        outputTokens: Math.floor(totalTokens * 0.3),
        cacheReadTokens: Math.floor(totalTokens * 0.08),
        cacheWriteTokens: Math.floor(totalTokens * 0.02),
        totalTokens,
        cost: totalTokens * 0.00004,
      },
    ],
  };
}

function createProvider(name: string, displayName: string): ProviderData {
  return {
    provider: name,
    displayName,
    daily: [createDailyUsage('2026-03-01', 5000)],
    totalTokens: 5000,
    totalCost: 0.2,
    colors: {
      primary: '#d97706',
      secondary: '#fbbf24',
      gradient: ['#d97706', '#fbbf24'],
    },
  };
}

function createOutput(overrides: Partial<TokenleakOutput> = {}): TokenleakOutput {
  return {
    schemaVersion: SCHEMA_VERSION,
    generated: '2026-03-11T00:00:00.000Z',
    dateRange: { since: '2026-01-01', until: '2026-03-11' },
    providers: [createProvider('claude-code', 'Claude Code')],
    aggregated: createPopulatedStats(),
    ...overrides,
  };
}

describe('renderWrappedCard', () => {
  it('has viewBox 1200x630', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('viewBox="0 0 1200 630"');
  });

  it('has width 1200 and height 630', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
  });

  it('produces valid SVG with opening and closing tags', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg.trim()).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('includes Tokenleak Wrapped title', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('Tokenleak Wrapped');
  });

  it('includes tokenleak watermark', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('tokenleak');
  });

  it('includes streak count', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('7 days');
  });

  it('includes provider name', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('Claude Code');
  });

  it('includes date range', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('2026-01-01');
    expect(svg).toContain('2026-03-11');
  });

  it('dark vs light theme produces different SVG', () => {
    const output = createOutput();
    const dark = renderWrappedCard(output, 'dark');
    const light = renderWrappedCard(output, 'light');
    expect(dark).not.toBe(light);
    expect(dark).toContain('#0d1117');
    expect(light).toContain('#ffffff');
  });

  it('handles empty providers gracefully', () => {
    const output = createOutput({
      providers: [],
      aggregated: createPopulatedStats({ currentStreak: 0 }),
    });
    const svg = renderWrappedCard(output);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
});

describe('renderBadge', () => {
  it('produces valid SVG', () => {
    const svg = renderBadge(createPopulatedStats());
    expect(svg.trim()).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('contains streak count text', () => {
    const svg = renderBadge(createPopulatedStats({ currentStreak: 7 }));
    expect(svg).toContain('7 days');
  });

  it('contains streak label', () => {
    const svg = renderBadge(createPopulatedStats());
    expect(svg).toContain('streak');
  });

  it('has prefers-color-scheme media query', () => {
    const svg = renderBadge(createPopulatedStats());
    expect(svg).toContain('prefers-color-scheme');
    expect(svg).toContain('prefers-color-scheme: dark');
    expect(svg).toContain('prefers-color-scheme: light');
  });

  it('updates value when streak changes', () => {
    const svg0 = renderBadge(createPopulatedStats({ currentStreak: 0 }));
    const svg42 = renderBadge(createPopulatedStats({ currentStreak: 42 }));
    expect(svg0).toContain('0 days');
    expect(svg42).toContain('42 days');
  });

  it('has <style> element', () => {
    const svg = renderBadge(createPopulatedStats());
    expect(svg).toContain('<style>');
    expect(svg).toContain('</style>');
  });
});
