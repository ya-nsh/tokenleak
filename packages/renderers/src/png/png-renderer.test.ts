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
import { PngRenderer } from './png-renderer';

/** PNG magic bytes: 0x89 P N G */
const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];

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
    { model: 'claude-3-sonnet', tokens: 30000, cost: 0.6, percentage: 30 },
  ];
}

function createPopulatedStats(): AggregatedStats {
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
    totalCost: 4.0,
    totalDays: 40,
    activeDays: 30,
    dayOfWeek: createDayOfWeek(),
    topModels: createTopModels(),
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
    daily: [
      createDailyUsage('2026-03-01', 5000),
      createDailyUsage('2026-03-02', 3000),
    ],
    totalTokens: 8000,
    totalCost: 0.32,
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

function createRenderOptions(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    format: 'png',
    theme: 'dark',
    width: 800,
    showInsights: false,
    noColor: false,
    output: null,
    ...overrides,
  };
}

describe('PngRenderer', () => {
  const renderer = new PngRenderer();

  it('has format set to png', () => {
    expect(renderer.format).toBe('png');
  });

  it('output starts with PNG magic bytes', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    const buffer = Buffer.from(result);

    expect(buffer[0]).toBe(PNG_MAGIC_BYTES[0]);
    expect(buffer[1]).toBe(PNG_MAGIC_BYTES[1]);
    expect(buffer[2]).toBe(PNG_MAGIC_BYTES[2]);
    expect(buffer[3]).toBe(PNG_MAGIC_BYTES[3]);
  });

  it('output buffer has non-zero length', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    expect(result.length).toBeGreaterThan(0);
  });

  it('dark vs light theme produces different buffers', async () => {
    const output = createOutput();
    const darkBuffer = await renderer.render(output, createRenderOptions({ theme: 'dark' }));
    const lightBuffer = await renderer.render(output, createRenderOptions({ theme: 'light' }));

    // Both should be valid PNGs
    expect(darkBuffer[0]).toBe(PNG_MAGIC_BYTES[0]);
    expect(lightBuffer[0]).toBe(PNG_MAGIC_BYTES[0]);

    // They should differ (different background colors at minimum)
    const darkHex = Buffer.from(darkBuffer).toString('hex');
    const lightHex = Buffer.from(lightBuffer).toString('hex');
    expect(darkHex).not.toBe(lightHex);
  });

  it('returns a Buffer instance', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});
