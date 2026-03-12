import { describe, expect, it } from 'bun:test';
import type {
  DailyUsage,
  ModelBreakdown,
  ProviderData,
  ProviderColors,
  AggregatedStats,
  DayOfWeekEntry,
  TopModelEntry,
  ProviderResult,
  TokenleakOutput,
  RenderOptions,
  DateRange,
  CompareOutput,
  CompareDeltas,
} from './types';
import { DEFAULT_DAYS, DEFAULT_CONCURRENCY, MAX_JSONL_RECORD_BYTES, SCHEMA_VERSION } from './constants';

describe('core types', () => {
  it('DailyUsage has required shape', () => {
    const usage: DailyUsage = {
      date: '2025-01-15',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      totalTokens: 1800,
      cost: 0.05,
      models: [],
    };
    expect(usage.date).toBe('2025-01-15');
    expect(usage.totalTokens).toBe(1800);
    expect(usage.models).toEqual([]);
  });

  it('ModelBreakdown has required shape', () => {
    const breakdown: ModelBreakdown = {
      model: 'claude-sonnet-4-20250514',
      inputTokens: 500,
      outputTokens: 300,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
      totalTokens: 950,
      cost: 0.02,
    };
    expect(breakdown.model).toBe('claude-sonnet-4-20250514');
    expect(breakdown.totalTokens).toBe(950);
  });

  it('ProviderData has required shape', () => {
    const data: ProviderData = {
      provider: 'claude-code',
      displayName: 'Claude Code',
      daily: [],
      totalTokens: 0,
      totalCost: 0,
      colors: { primary: '#ff6b35', secondary: '#ffa366', gradient: ['#ff6b35', '#ffa366'] },
    };
    expect(data.provider).toBe('claude-code');
    expect(data.daily).toEqual([]);
  });

  it('ProviderColors gradient is a tuple of two strings', () => {
    const colors: ProviderColors = {
      primary: '#ff6b35',
      secondary: '#ffa366',
      gradient: ['#ff6b35', '#ffa366'],
    };
    expect(colors.gradient).toHaveLength(2);
    expect(typeof colors.gradient[0]).toBe('string');
    expect(typeof colors.gradient[1]).toBe('string');
  });

  it('AggregatedStats has all stat fields', () => {
    const stats: AggregatedStats = {
      currentStreak: 5,
      longestStreak: 10,
      rolling30dTokens: 100000,
      rolling30dCost: 5.0,
      rolling7dTokens: 25000,
      rolling7dCost: 1.25,
      peakDay: { date: '2025-01-10', tokens: 15000 },
      averageDailyTokens: 3500,
      averageDailyCost: 0.17,
      cacheHitRate: 0.45,
      totalTokens: 300000,
      totalInputTokens: 180000,
      totalOutputTokens: 90000,
      totalCost: 15.0,
      totalDays: 90,
      activeDays: 45,
      dayOfWeek: [],
      topModels: [],
      rolling30dTopModel: null,
    };
    expect(stats.currentStreak).toBe(5);
    expect(stats.peakDay?.tokens).toBe(15000);
    expect(stats.cacheHitRate).toBe(0.45);
  });

  it('AggregatedStats peakDay can be null', () => {
    const stats: AggregatedStats = {
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
    expect(stats.peakDay).toBeNull();
  });

  it('DayOfWeekEntry has required shape', () => {
    const entry: DayOfWeekEntry = { day: 1, label: 'Monday', tokens: 5000, cost: 0.25, count: 10 };
    expect(entry.day).toBe(1);
    expect(entry.label).toBe('Monday');
  });

  it('TopModelEntry has percentage field', () => {
    const entry: TopModelEntry = { model: 'claude-sonnet-4', tokens: 50000, cost: 2.5, percentage: 65 };
    expect(entry.percentage).toBe(65);
  });

  it('ProviderResult can hold data or error', () => {
    const success: ProviderResult = { provider: 'claude-code', data: null, error: null };
    const failure: ProviderResult = { provider: 'codex', data: null, error: 'Not found' };
    expect(success.error).toBeNull();
    expect(failure.error).toBe('Not found');
  });

  it('TokenleakOutput has schemaVersion and providers', () => {
    const output: TokenleakOutput = {
      schemaVersion: 1,
      generated: '2025-01-15T00:00:00Z',
      dateRange: { since: '2025-01-01', until: '2025-01-15' },
      providers: [],
      aggregated: {
        currentStreak: 0, longestStreak: 0,
        rolling30dTokens: 0, rolling30dCost: 0,
        rolling7dTokens: 0, rolling7dCost: 0,
        peakDay: null,
        averageDailyTokens: 0, averageDailyCost: 0,
        cacheHitRate: 0,
        totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0,
        totalDays: 0, activeDays: 0,
        dayOfWeek: [], topModels: [],
        rolling30dTopModel: null,
      },
    };
    expect(output.schemaVersion).toBe(1);
    expect(output.providers).toEqual([]);
  });

  it('RenderOptions has all format types', () => {
    const opts: RenderOptions[] = [
      { format: 'json', theme: 'dark', width: 80, showInsights: true, noColor: false, output: null },
      { format: 'svg', theme: 'light', width: 1200, showInsights: false, noColor: false, output: 'out.svg' },
      { format: 'png', theme: 'dark', width: 1200, showInsights: true, noColor: false, output: 'out.png' },
      { format: 'terminal', theme: 'dark', width: 80, showInsights: true, noColor: true, output: null },
    ];
    expect(opts).toHaveLength(4);
    expect(opts[0].format).toBe('json');
    expect(opts[3].noColor).toBe(true);
  });

  it('DateRange has since and until strings', () => {
    const range: DateRange = { since: '2025-01-01', until: '2025-01-31' };
    expect(range.since).toBe('2025-01-01');
    expect(range.until).toBe('2025-01-31');
  });

  it('CompareOutput has two periods and deltas', () => {
    const zeroed: AggregatedStats = {
      currentStreak: 0, longestStreak: 0,
      rolling30dTokens: 0, rolling30dCost: 0,
      rolling7dTokens: 0, rolling7dCost: 0,
      peakDay: null,
      averageDailyTokens: 0, averageDailyCost: 0,
      cacheHitRate: 0,
      totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0,
      totalDays: 0, activeDays: 0,
      dayOfWeek: [], topModels: [],
      rolling30dTopModel: null,
    };
    const compare: CompareOutput = {
      schemaVersion: 1,
      generated: '2025-01-15T00:00:00Z',
      periodA: { range: { since: '2025-01-01', until: '2025-01-07' }, stats: zeroed },
      periodB: { range: { since: '2025-01-08', until: '2025-01-14' }, stats: zeroed },
      deltas: { tokens: 0, cost: 0, streak: 0, activeDays: 0, averageDailyTokens: 0, cacheHitRate: 0 },
    };
    expect(compare.periodA.range.since).toBe('2025-01-01');
    expect(compare.deltas.tokens).toBe(0);
  });

  it('CompareDeltas can be negative', () => {
    const deltas: CompareDeltas = {
      tokens: -5000,
      cost: -0.25,
      streak: -3,
      activeDays: -2,
      averageDailyTokens: -1000,
      cacheHitRate: -0.1,
    };
    expect(deltas.tokens).toBeLessThan(0);
    expect(deltas.cost).toBeLessThan(0);
  });
});

describe('constants', () => {
  it('DEFAULT_DAYS is 90', () => {
    expect(DEFAULT_DAYS).toBe(90);
  });

  it('DEFAULT_CONCURRENCY is 3', () => {
    expect(DEFAULT_CONCURRENCY).toBe(3);
  });

  it('MAX_JSONL_RECORD_BYTES is 10MB', () => {
    expect(MAX_JSONL_RECORD_BYTES).toBe(10 * 1024 * 1024);
  });

  it('SCHEMA_VERSION is 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
