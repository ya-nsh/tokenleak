import type {
  TokenleakOutput,
  RenderOptions,
  AggregatedStats,
  ProviderData,
  DailyUsage,
  DayOfWeekEntry,
  TopModelEntry,
  MoreStats,
  UsageEvent,
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
    events: createUsageEvents(name),
  };
}

export function createUsageEvents(provider: string = 'claude-code'): UsageEvent[] {
  return [
    {
      provider,
      timestamp: '2026-03-01T09:15:00.000Z',
      date: '2026-03-01',
      model: 'claude-3-opus',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 50,
      totalTokens: 1750,
      cost: 0.2,
      sessionId: `${provider}-session-a`,
      projectId: 'project-alpha',
      durationMs: 120000,
    },
    {
      provider,
      timestamp: '2026-03-01T21:45:00.000Z',
      date: '2026-03-01',
      model: 'claude-3-sonnet',
      inputTokens: 800,
      outputTokens: 400,
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
      totalTokens: 1320,
      cost: 0.12,
      sessionId: `${provider}-session-a`,
      projectId: 'project-alpha',
      durationMs: 180000,
    },
    {
      provider,
      timestamp: '2026-03-02T14:30:00.000Z',
      date: '2026-03-02',
      model: 'claude-3-haiku',
      inputTokens: 600,
      outputTokens: 300,
      cacheReadTokens: 80,
      cacheWriteTokens: 15,
      totalTokens: 995,
      cost: 0.08,
      sessionId: `${provider}-session-b`,
      projectId: 'project-beta',
      durationMs: 90000,
    },
  ];
}

export function createMoreStats(overrides: Partial<MoreStats> = {}): MoreStats {
  return {
    inputOutput: {
      inputPerOutput: 2,
      outputPerInput: 0.5,
      outputShare: 0.333,
    },
    monthlyBurn: {
      projectedTokens: 155000,
      projectedCost: 6.2,
      observedDays: 14,
      calendarDays: 31,
    },
    cacheEconomics: {
      readTokens: 8000,
      writeTokens: 2000,
      readCoverage: 0.4,
      reuseRatio: 4,
    },
    hourOfDay: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      tokens: hour === 14 ? 6000 : hour === 21 ? 4500 : hour === 9 ? 3000 : 500,
      cost: hour === 14 ? 0.6 : 0.05,
      count: hour === 14 ? 3 : 1,
    })),
    sessionMetrics: {
      totalSessions: 2,
      averageTokens: 24000,
      averageCost: 0.6,
      averageMessages: 4,
      averageDurationMs: 240000,
      longestSession: {
        label: 'project-alpha',
        tokens: 33000,
        cost: 1.2,
        count: 6,
        durationMs: 420000,
      },
      projectCount: 2,
      topProject: {
        name: 'project-alpha',
        tokens: 33000,
      },
      projectBreakdown: [
        { name: 'project-alpha', tokens: 33000 },
        { name: 'project-beta', tokens: 15000 },
      ],
    },
    compare: null,
    ...overrides,
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
    more: null,
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
