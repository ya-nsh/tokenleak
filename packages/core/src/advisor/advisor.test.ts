import { describe, expect, it } from 'bun:test';
import { analyzeEfficiency } from './advisor';
import { DOWNGRADE_PATHS } from './downgrade-paths';
import type { AdvisorModelPricing } from './types';
import type { TokenleakOutput, ProviderData, UsageEvent, AggregatedStats } from '../types';

// Real pricing for models used in tests (matches @tokenleak/registry MODEL_PRICING)
const TEST_PRICING: Readonly<Record<string, AdvisorModelPricing>> = {
  'claude-opus-4': {
    input: 15.00,
    output: 75.00,
    cacheRead: 1.50,
    cacheWrite: 18.75,
  },
  'claude-sonnet-4': {
    input: 3.00,
    output: 15.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  'claude-3-opus': {
    input: 15.00,
    output: 75.00,
    cacheRead: 1.50,
    cacheWrite: 18.75,
  },
  'claude-3.5-sonnet': {
    input: 3.00,
    output: 15.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
  },
  'claude-3.5-haiku': {
    input: 0.80,
    output: 4.00,
    cacheRead: 0.08,
    cacheWrite: 1.00,
  },
  'gpt-4o': {
    input: 2.50,
    output: 10.00,
    cacheRead: 1.25,
    cacheWrite: 2.50,
  },
  'gpt-4o-mini': {
    input: 0.15,
    output: 0.60,
    cacheRead: 0.075,
    cacheWrite: 0.15,
  },
};

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: '2026-03-01T09:00:00.000Z',
    date: '2026-03-01',
    model: 'claude-opus-4',
    inputTokens: 5000,
    outputTokens: 200,
    cacheReadTokens: 1000,
    cacheWriteTokens: 500,
    totalTokens: 6700,
    cost: 0.50,
    ...overrides,
  };
}

function makeEvents(count: number, overrides: Partial<UsageEvent> = {}): UsageEvent[] {
  return Array.from({ length: count }, (_, i) =>
    makeEvent({
      timestamp: `2026-03-${String((i % 28) + 1).padStart(2, '0')}T09:00:00.000Z`,
      date: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
      ...overrides,
    }),
  );
}

function makeAggregatedStats(overrides: Partial<AggregatedStats> = {}): AggregatedStats {
  return {
    currentStreak: 5,
    longestStreak: 10,
    rolling30dTokens: 100000,
    rolling30dCost: 50.0,
    rolling7dTokens: 30000,
    rolling7dCost: 15.0,
    peakDay: { date: '2026-03-05', tokens: 20000 },
    averageDailyTokens: 3333,
    averageDailyCost: 1.67,
    cacheHitRate: 0.15,
    totalTokens: 100000,
    totalInputTokens: 60000,
    totalOutputTokens: 10000,
    totalCost: 50.0,
    totalDays: 30,
    activeDays: 25,
    dayOfWeek: [],
    topModels: [
      { model: 'claude-opus-4', tokens: 90000, cost: 45.0, percentage: 90 },
      { model: 'claude-sonnet-4', tokens: 10000, cost: 5.0, percentage: 10 },
    ],
    rolling30dTopModel: 'claude-opus-4',
    ...overrides,
  };
}

function makeOutput(overrides: Partial<TokenleakOutput> = {}): TokenleakOutput {
  const events = makeEvents(25);
  const provider: ProviderData = {
    provider: 'claude-code',
    displayName: 'Claude Code',
    daily: [
      {
        date: '2026-03-01',
        inputTokens: 125000,
        outputTokens: 5000,
        cacheReadTokens: 25000,
        cacheWriteTokens: 12500,
        totalTokens: 167500,
        cost: 12.50,
        models: [
          {
            model: 'claude-opus-4',
            inputTokens: 125000,
            outputTokens: 5000,
            cacheReadTokens: 25000,
            cacheWriteTokens: 12500,
            totalTokens: 167500,
            cost: 12.50,
          },
        ],
      },
    ],
    totalTokens: 167500,
    totalCost: 12.50,
    colors: { primary: '#7c3aed', secondary: '#a78bfa', gradient: ['#7c3aed', '#a78bfa'] },
    events,
  };

  return {
    schemaVersion: 1,
    generated: '2026-03-15T00:00:00.000Z',
    dateRange: { since: '2026-03-01', until: '2026-03-30' },
    providers: [provider],
    aggregated: makeAggregatedStats(),
    more: {
      inputOutput: { inputPerOutput: 12.5, outputPerInput: 0.08, outputShare: 0.074 },
      monthlyBurn: { projectedTokens: 167500, projectedCost: 12.50, observedDays: 30, calendarDays: 31 },
      cacheEconomics: { readTokens: 25000, writeTokens: 12500, readCoverage: 0.167, reuseRatio: 2.0 },
      hourOfDay: [],
      sessionMetrics: {
        totalSessions: 1,
        averageTokens: 167500,
        averageCost: 12.50,
        averageMessages: 25,
        averageDurationMs: null,
        longestSession: null,
        projectCount: 0,
        topProject: null,
        projectBreakdown: [],
      },
      sessionDrilldown: [],
      projectDrilldown: [],
      compare: null,
    },
    ...overrides,
  };
}

describe('analyzeEfficiency', () => {
  it('detects model downgrade when using expensive model with low output tokens', () => {
    const output = makeOutput();
    const report = analyzeEfficiency(output, TEST_PRICING);

    const downgradeRecs = report.recommendations.filter((r) => r.type === 'model-downgrade');
    expect(downgradeRecs.length).toBeGreaterThanOrEqual(1);

    const opusRec = downgradeRecs.find(
      (r) => r.details['model'] === 'claude-opus-4',
    );
    expect(opusRec).toBeDefined();
    expect(opusRec!.details['downgradeTo']).toBe('claude-sonnet-4');
    expect(opusRec!.monthlySavings).toBeGreaterThan(0);
  });

  it('does not suggest downgrade when output tokens are high', () => {
    const events = makeEvents(25, { outputTokens: 2000 });
    const provider: ProviderData = {
      provider: 'claude-code',
      displayName: 'Claude Code',
      daily: [],
      totalTokens: 100000,
      totalCost: 50.0,
      colors: { primary: '#7c3aed', secondary: '#a78bfa', gradient: ['#7c3aed', '#a78bfa'] },
      events,
    };

    const output = makeOutput({
      providers: [provider],
    });

    const report = analyzeEfficiency(output, TEST_PRICING);
    const downgradeRecs = report.recommendations.filter(
      (r) => r.type === 'model-downgrade' && r.details['model'] === 'claude-opus-4',
    );
    expect(downgradeRecs.length).toBe(0);
  });

  it('does not suggest downgrade when model has no downgrade path', () => {
    const events = makeEvents(25, { model: 'claude-sonnet-4', outputTokens: 100 });
    const provider: ProviderData = {
      provider: 'claude-code',
      displayName: 'Claude Code',
      daily: [],
      totalTokens: 100000,
      totalCost: 50.0,
      colors: { primary: '#7c3aed', secondary: '#a78bfa', gradient: ['#7c3aed', '#a78bfa'] },
      events,
    };

    const output = makeOutput({ providers: [provider] });
    const report = analyzeEfficiency(output, TEST_PRICING);

    // claude-sonnet-4 has no downgrade path in DOWNGRADE_PATHS
    const downgradeRecs = report.recommendations.filter(
      (r) => r.type === 'model-downgrade' && r.details['model'] === 'claude-sonnet-4',
    );
    expect(downgradeRecs.length).toBe(0);
  });

  it('flags cache optimization when hit rate < 30%', () => {
    const output = makeOutput();
    // Default aggregated has cacheHitRate: 0.15 which is < 30%
    const report = analyzeEfficiency(output, TEST_PRICING);

    const cacheRecs = report.recommendations.filter((r) => r.type === 'cache-optimization');
    expect(cacheRecs.length).toBeGreaterThanOrEqual(1);
    expect(cacheRecs[0]!.title).toContain('cache');
  });

  it('does not flag cache when hit rate > 50%', () => {
    const output = makeOutput({
      aggregated: makeAggregatedStats({ cacheHitRate: 0.55 }),
    });

    const report = analyzeEfficiency(output, TEST_PRICING);
    const cacheRecs = report.recommendations.filter((r) => r.type === 'cache-optimization');
    expect(cacheRecs.length).toBe(0);
  });

  it('flags cache reuse ratio below threshold', () => {
    const output = makeOutput();
    output.more!.cacheEconomics = {
      readTokens: 1000,
      writeTokens: 5000,
      readCoverage: 0.01,
      reuseRatio: 0.2,
    };

    const report = analyzeEfficiency(output, TEST_PRICING);
    const reuseRecs = report.recommendations.filter(
      (r) => r.type === 'cache-optimization' && r.title.includes('wasted'),
    );
    expect(reuseRecs.length).toBe(1);
  });

  it('detects concentration risk at >85% single model spend', () => {
    // Default topModels has claude-opus-4 at 90% cost
    const output = makeOutput();
    const report = analyzeEfficiency(output, TEST_PRICING);

    const concentrationRecs = report.recommendations.filter(
      (r) => r.type === 'usage-pattern' && r.title.includes('concentration'),
    );
    expect(concentrationRecs.length).toBe(1);
    expect(concentrationRecs[0]!.details['model']).toBe('claude-opus-4');
  });

  it('returns empty recommendations for empty data', () => {
    const output: TokenleakOutput = {
      schemaVersion: 1,
      generated: '2026-03-15T00:00:00.000Z',
      dateRange: { since: '2026-03-01', until: '2026-03-30' },
      providers: [],
      aggregated: makeAggregatedStats({
        totalCost: 0,
        totalTokens: 0,
        averageDailyCost: 0,
        cacheHitRate: 0.5,
        topModels: [],
      }),
      more: null,
    };

    const report = analyzeEfficiency(output, TEST_PRICING);
    expect(report.recommendations.length).toBe(0);
    expect(report.totalCurrentMonthlyCost).toBe(0);
    expect(report.totalMonthlySavings).toBe(0);
    expect(report.analyzedEvents).toBe(0);
  });

  it('assigns confidence based on event count thresholds', () => {
    // 25 events => high confidence
    const highOutput = makeOutput();
    const highReport = analyzeEfficiency(highOutput, TEST_PRICING);
    const highRecs = highReport.recommendations.filter(
      (r) => r.type === 'model-downgrade' && r.details['model'] === 'claude-opus-4',
    );
    expect(highRecs.length).toBeGreaterThan(0);
    expect(highRecs[0]!.confidence).toBe('high');

    // 10 events => medium
    const medEvents = makeEvents(10);
    const medProvider: ProviderData = {
      provider: 'claude-code',
      displayName: 'Claude Code',
      daily: highOutput.providers[0]!.daily,
      totalTokens: 100000,
      totalCost: 50.0,
      colors: { primary: '#7c3aed', secondary: '#a78bfa', gradient: ['#7c3aed', '#a78bfa'] },
      events: medEvents,
    };
    const medOutput = makeOutput({ providers: [medProvider] });
    const medReport = analyzeEfficiency(medOutput, TEST_PRICING);
    const medRecs = medReport.recommendations.filter(
      (r) => r.type === 'model-downgrade' && r.details['model'] === 'claude-opus-4',
    );
    expect(medRecs.length).toBeGreaterThan(0);
    expect(medRecs[0]!.confidence).toBe('medium');

    // 3 events => low
    const lowEvents = makeEvents(3);
    const lowProvider: ProviderData = {
      provider: 'claude-code',
      displayName: 'Claude Code',
      daily: highOutput.providers[0]!.daily,
      totalTokens: 100000,
      totalCost: 50.0,
      colors: { primary: '#7c3aed', secondary: '#a78bfa', gradient: ['#7c3aed', '#a78bfa'] },
      events: lowEvents,
    };
    const lowOutput = makeOutput({ providers: [lowProvider] });
    const lowReport = analyzeEfficiency(lowOutput, TEST_PRICING);
    const lowRecs = lowReport.recommendations.filter(
      (r) => r.type === 'model-downgrade' && r.details['model'] === 'claude-opus-4',
    );
    expect(lowRecs.length).toBeGreaterThan(0);
    expect(lowRecs[0]!.confidence).toBe('low');
  });

  it('calculates monthly savings correctly against known pricing', () => {
    // 25 events, each with 5000 input, 200 output, 1000 cache read, 500 cache write tokens
    // using claude-opus-4 pricing:
    //   input cost:  25 * 5000 / 1M * 15.00 = 1.875
    //   output cost: 25 * 200  / 1M * 75.00 = 0.375
    //   cache read:  25 * 1000 / 1M * 1.50  = 0.0375
    //   cache write: 25 * 500  / 1M * 18.75 = 0.234375
    //   total opus = 2.521875

    // Same tokens with claude-sonnet-4 pricing:
    //   input cost:  25 * 5000 / 1M * 3.00  = 0.375
    //   output cost: 25 * 200  / 1M * 15.00 = 0.075
    //   cache read:  25 * 1000 / 1M * 0.30  = 0.0075
    //   cache write: 25 * 500  / 1M * 3.75  = 0.046875
    //   total sonnet = 0.504375

    // savings = 2.521875 - 0.504375 = 2.017500
    // monthly (30 days, 30 analyzed days) = 2.01750 * (30/30) = 2.01750

    const output = makeOutput();
    const report = analyzeEfficiency(output, TEST_PRICING);

    const rec = report.recommendations.find(
      (r) => r.type === 'model-downgrade' && r.details['model'] === 'claude-opus-4',
    );
    expect(rec).toBeDefined();

    // Verify savings are close to expected
    const expectedSavings = 2.0175;
    expect(rec!.monthlySavings).toBeCloseTo(expectedSavings, 2);
  });

  it('detects burst days exceeding 3x average', () => {
    const provider: ProviderData = {
      provider: 'claude-code',
      displayName: 'Claude Code',
      daily: [
        {
          date: '2026-03-01',
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 1100,
          cost: 0.50,
          models: [],
        },
        {
          date: '2026-03-02',
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 1100,
          cost: 0.50,
          models: [],
        },
        {
          date: '2026-03-03',
          inputTokens: 10000,
          outputTokens: 5000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 15000,
          cost: 10.00,
          models: [],
        },
      ],
      totalTokens: 17200,
      totalCost: 11.00,
      colors: { primary: '#7c3aed', secondary: '#a78bfa', gradient: ['#7c3aed', '#a78bfa'] },
      events: [],
    };

    const output = makeOutput({
      providers: [provider],
      aggregated: makeAggregatedStats({
        averageDailyCost: 0.50,
        totalCost: 11.00,
        cacheHitRate: 0.5,
        topModels: [{ model: 'claude-opus-4', tokens: 17200, cost: 11.00, percentage: 100 }],
      }),
    });

    const report = analyzeEfficiency(output, TEST_PRICING);
    const burstRecs = report.recommendations.filter(
      (r) => r.type === 'usage-pattern' && r.title.includes('burst'),
    );
    expect(burstRecs.length).toBe(1);
    expect(burstRecs[0]!.details['topBurstDate']).toBe('2026-03-03');
  });

  it('reports correct analyzedDays and analyzedEvents', () => {
    const output = makeOutput();
    const report = analyzeEfficiency(output, TEST_PRICING);

    expect(report.analyzedDays).toBe(30);
    expect(report.analyzedEvents).toBe(25);
  });
});

describe('DOWNGRADE_PATHS', () => {
  it('maps opus models to sonnet alternatives', () => {
    expect(DOWNGRADE_PATHS['claude-opus-4']).toBe('claude-sonnet-4');
    expect(DOWNGRADE_PATHS['claude-opus-4-6']).toBe('claude-sonnet-4-6');
    expect(DOWNGRADE_PATHS['claude-3-opus']).toBe('claude-3.5-sonnet');
  });

  it('maps gpt-4o to gpt-4o-mini', () => {
    expect(DOWNGRADE_PATHS['gpt-4o']).toBe('gpt-4o-mini');
  });

  it('maps o-series to mini variants', () => {
    expect(DOWNGRADE_PATHS['o1']).toBe('o1-mini');
    expect(DOWNGRADE_PATHS['o3']).toBe('o3-mini');
  });
});
