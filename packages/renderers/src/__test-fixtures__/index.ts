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

export function createDayOfWeek(): DayOfWeekEntry[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.map((label, i) => ({
    day: i,
    label,
    tokens: (i + 1) * 1000,
    cost: (i + 1) * 0.01,
    count: i + 1,
  }));
}

export function createTopModels(): TopModelEntry[] {
  return [
    { model: 'claude-3-opus', tokens: 50000, cost: 1.5, percentage: 50 },
    { model: 'claude-3-sonnet', tokens: 30000, cost: 0.6, percentage: 30 },
    { model: 'claude-3-haiku', tokens: 20000, cost: 0.1, percentage: 20 },
  ];
}

export function createZeroedStats(): AggregatedStats {
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
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    totalDays: 0,
    activeDays: 0,
    dayOfWeek: [],
    topModels: [],
    rolling30dTopModel: null,
  };
}

export function createPopulatedStats(
  overrides: Partial<AggregatedStats> = {},
): AggregatedStats {
  return {
    currentStreak: 5,
    longestStreak: 12,
    rolling30dTokens: 80000,
    rolling30dCost: 3.2,
    rolling7dTokens: 20000,
    rolling7dCost: 0.8,
    peakDay: { date: '2026-03-01', tokens: 8000 },
    averageDailyTokens: 2500,
    averageDailyCost: 0.1,
    cacheHitRate: 0.42,
    totalTokens: 100000,
    totalInputTokens: 60000,
    totalOutputTokens: 30000,
    totalCost: 4.0,
    totalDays: 40,
    activeDays: 30,
    dayOfWeek: createDayOfWeek(),
    topModels: createTopModels(),
    rolling30dTopModel: 'claude-3-opus',
    ...overrides,
  };
}

export function createDailyUsage(date: string, totalTokens: number): DailyUsage {
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

export function createProvider(name: string, displayName: string): ProviderData {
  return {
    provider: name,
    displayName,
    daily: [
      createDailyUsage('2026-03-01', 5000),
      createDailyUsage('2026-03-02', 3000),
      createDailyUsage('2026-03-03', 7000),
    ],
    totalTokens: 15000,
    totalCost: 0.6,
    colors: {
      primary: '#d97706',
      secondary: '#fbbf24',
      gradient: ['#d97706', '#fbbf24'],
    },
  };
}

export function createOutput(
  overrides: Partial<TokenleakOutput> = {},
): TokenleakOutput {
  return {
    schemaVersion: SCHEMA_VERSION,
    generated: '2026-03-11T00:00:00.000Z',
    dateRange: { since: '2026-01-01', until: '2026-03-11' },
    providers: [createProvider('claude-code', 'Claude Code')],
    aggregated: createPopulatedStats(),
    ...overrides,
  };
}

export function createRenderOptions(
  overrides: Partial<RenderOptions> = {},
): RenderOptions {
  return {
    format: 'svg',
    theme: 'dark',
    width: 800,
    showInsights: true,
    noColor: false,
    output: null,
    ...overrides,
  };
}
