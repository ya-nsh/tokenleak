import { describe, expect, test } from 'bun:test';
import type { DailyUsage, DateRange, ProviderData, SavingsKind, UsageEvent } from '../types';
import { buildSavingsReport, describePricingGap, filterBySeverity } from './savings';

const range: DateRange = { since: '2026-05-01', until: '2026-05-10' };

const pricing = {
  'claude-3-opus': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-3.5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
} as const;

function event(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: '2026-05-02T10:00:00.000Z',
    date: '2026-05-02',
    model: 'claude-3-opus',
    inputTokens: 10_000,
    outputTokens: 400,
    cacheReadTokens: 2_000,
    cacheWriteTokens: 500,
    totalTokens: 12_900,
    cost: 0.195375,
    pricing: pricing['claude-3-opus'],
    costSource: 'calculated',
    sessionId: 's1',
    projectId: '/work/repo',
    repoRoot: '/work/repo',
    durationMs: 120_000,
    prompt: 'fix the lint error',
    ...overrides,
  };
}

/** Provider data with one daily row per event date, so cache and spend detectors see real days. */
function provider(events: UsageEvent[], name = 'claude-code'): ProviderData {
  const byDate = new Map<string, DailyUsage>();
  for (const e of events) {
    const day = byDate.get(e.date) ?? {
      date: e.date,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
      models: [],
    };
    day.inputTokens += e.inputTokens;
    day.outputTokens += e.outputTokens;
    day.cacheReadTokens += e.cacheReadTokens;
    day.cacheWriteTokens += e.cacheWriteTokens;
    day.totalTokens += e.totalTokens;
    day.cost += e.cost;
    const model = day.models.find((m) => m.model === e.model);
    if (model) {
      model.cost += e.cost;
      model.totalTokens += e.totalTokens;
    } else {
      day.models.push({
        model: e.model,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        cacheReadTokens: e.cacheReadTokens,
        cacheWriteTokens: e.cacheWriteTokens,
        totalTokens: e.totalTokens,
        cost: e.cost,
      });
    }
    byDate.set(e.date, day);
  }
  return {
    provider: name,
    displayName: name === 'claude-code' ? 'Claude Code' : name,
    colors: { primary: '#fff', secondary: '#ddd', gradient: ['#fff', '#ddd'] },
    totalTokens: events.reduce((sum, e) => sum + e.totalTokens, 0),
    totalCost: events.reduce((sum, e) => sum + e.cost, 0),
    daily: [...byDate.values()],
    events,
  };
}

function report(
  events: UsageEvent[],
  options: { pricing?: Record<string, (typeof pricing)['claude-3-opus']> } = {},
) {
  return buildSavingsReport({
    providers: [provider(events)],
    dateRange: range,
    pricing: options.pricing ?? {},
  });
}

function kinds(events: UsageEvent[], options?: Parameters<typeof report>[1]): SavingsKind[] {
  return report(events, options).recommendations.map((r) => r.kind);
}

describe('buildSavingsReport', () => {
  test('returns an empty, zeroed report for no data instead of throwing', () => {
    const empty = buildSavingsReport({ providers: [], dateRange: range, pricing: {} });
    expect(empty.recommendations).toEqual([]);
    expect(empty.summary).toMatchObject({
      totalRecommendations: 0,
      highSeverity: 0,
      currentCost: 0,
      estimatedSavings: null,
      monthlySavings: null,
      analyzedDays: 10,
      analyzedEvents: 0,
      analyzedSessions: 0,
      pricedTokenShare: 1,
      unpricedModels: [],
    });
  });

  test('counts a single-day window as one day', () => {
    const one = buildSavingsReport({
      providers: [],
      dateRange: { since: '2026-05-02', until: '2026-05-02' },
      pricing: {},
    });
    expect(one.summary.analyzedDays).toBe(1);
  });

  test('every recommendation carries a category, evidence, and a recipe', () => {
    const events = [
      event({ model: 'claude-3-opus', prompt: 'fix flaky tests' }),
      event({
        model: 'claude-3.5-sonnet',
        prompt: 'fix flaky tests again',
        pricing: pricing['claude-3.5-sonnet'],
      }),
      event({ model: 'claude-3-opus', prompt: 'fix flaky tests please' }),
      event({
        model: 'claude-3.5-sonnet',
        prompt: 'fix flaky tests',
        pricing: pricing['claude-3.5-sonnet'],
      }),
    ];
    const { recommendations } = report(events, { pricing });
    expect(recommendations.length).toBeGreaterThan(0);
    for (const recommendation of recommendations) {
      expect(recommendation.category).toBeTruthy();
      expect(recommendation.evidence.reason).toBeTruthy();
      expect(recommendation.recipes[0]?.detail).toBeTruthy();
    }
  });

  test('ranks by severity, then savings', () => {
    const { recommendations } = report(
      Array.from({ length: 40 }, (_, i) =>
        event({
          timestamp: new Date(Date.parse('2026-05-02T10:00:00.000Z') + i * 60_000).toISOString(),
          cost: 2,
        }),
      ),
      { pricing },
    );
    const rank = { high: 3, medium: 2, low: 1 };
    for (let i = 1; i < recommendations.length; i++) {
      const prev = recommendations[i - 1]!;
      const next = recommendations[i]!;
      expect(rank[prev.severity]).toBeGreaterThanOrEqual(rank[next.severity]);
      if (prev.severity === next.severity) {
        expect(prev.estimatedSavings ?? 0).toBeGreaterThanOrEqual(next.estimatedSavings ?? 0);
      }
    }
  });

  test('caps total savings at current cost when findings overlap', () => {
    const turns = Array.from({ length: 40 }, (_, i) =>
      event({
        timestamp: new Date(Date.parse('2026-05-02T10:00:00.000Z') + i * 60_000).toISOString(),
        inputTokens: 10,
        cacheReadTokens: 40_000 + i * 8_000,
        outputTokens: 5,
        totalTokens: 40_000 + i * 8_000 + 15,
        cost: 0.01,
        prompt: 'try again',
      }),
    );
    const result = report(turns, { pricing });
    const sum = result.recommendations.reduce((total, r) => total + (r.estimatedSavings ?? 0), 0);
    expect(sum).toBeGreaterThan(result.summary.currentCost);
    expect(result.summary.estimatedSavings).toBeCloseTo(result.summary.currentCost);
  });

  test('monthly savings scale the window rate to 30 days', () => {
    const result = report([event({}), event({ sessionId: 's2' }), event({ sessionId: 's3' })], {
      pricing,
    });
    for (const recommendation of result.recommendations) {
      if (recommendation.estimatedSavings === null) {
        expect(recommendation.monthlySavings).toBeNull();
      } else {
        expect(recommendation.monthlySavings).toBeCloseTo(
          (recommendation.estimatedSavings / 10) * 30,
        );
      }
    }
  });
});

describe('routing findings', () => {
  test('groups re-priced events per model route with the simulator savings', () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      event({ sessionId: `s${i}`, outputTokens: 300 }),
    );
    const routing = report(events, { pricing }).recommendations.find(
      (r) => r.kind === 'model-routing',
    );

    expect(routing).toBeDefined();
    expect(routing!.category).toBe('routing');
    expect(routing!.title).toBe('Route small tasks from claude-3-opus to claude-3.5-sonnet');
    expect(routing!.evidence.eventCount).toBe(6);
    // Re-priced at sonnet rates: 10k in, 300 out, 2k read, 500 write.
    const sonnetCost = (10_000 * 3 + 300 * 15 + 2_000 * 0.3 + 500 * 3.75) / 1_000_000;
    expect(routing!.estimatedSavings).toBeCloseTo(6 * (0.195375 - sonnetCost));
    expect(routing!.recipes[0]?.command).toBe('tokenleak simulate-routing');
  });

  test('produces no routing finding without a priced downgrade target', () => {
    expect(kinds([event({}), event({ sessionId: 's2' })])).not.toContain('model-routing');
  });

  test('marks sparse routes as low confidence', () => {
    const routing = report([event({})], { pricing }).recommendations.find(
      (r) => r.kind === 'model-routing',
    );
    expect(routing?.confidence).toBe('low');
  });
});

describe('cache findings', () => {
  test('prices a low hit rate at the provider’s own input and cache-read rates', () => {
    // 100k fresh input, 10k reads, 0 writes: 9% hit rate. At 50%, 45k more tokens come from cache.
    const events = [
      event({
        inputTokens: 100_000,
        cacheReadTokens: 10_000,
        cacheWriteTokens: 0,
        totalTokens: 110_400,
      }),
    ];
    const miss = report(events).recommendations.find((r) => r.kind === 'cache-miss-heavy');

    expect(miss).toBeDefined();
    expect(miss!.estimatedSavings).toBeCloseTo((45_000 * (15 - 1.5)) / 1_000_000);
    expect(miss!.evidence.reason).toContain('9%');
  });

  test('has no savings estimate when events carry no rates', () => {
    const events = [
      event({ inputTokens: 100_000, cacheReadTokens: 10_000, cacheWriteTokens: 0, pricing: null }),
    ];
    const miss = report(events).recommendations.find((r) => r.kind === 'cache-miss-heavy');
    expect(miss?.estimatedSavings).toBeNull();
    expect(miss?.confidence).toBe('low');
  });

  test('cache creation counts as a miss', () => {
    const events = [
      event({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 100,
        cacheWriteTokens: 900,
        totalTokens: 1000,
      }),
    ];
    expect(kinds(events)).toContain('cache-miss-heavy');
  });

  test('flags cache writes that are not read back, per provider', () => {
    const events = [
      event({
        inputTokens: 1_000,
        cacheReadTokens: 50_000,
        cacheWriteTokens: 200_000,
        totalTokens: 251_400,
      }),
    ];
    const waste = report(events).recommendations.find((r) => r.kind === 'cache-write-waste');
    expect(waste?.severity).toBe('medium');
    expect(waste?.evidence.reason).toContain('0.3x');
  });

  test('skips providers that never use the cache', () => {
    expect(kinds([event({ cacheReadTokens: 0, cacheWriteTokens: 0 })])).not.toContain(
      'cache-miss-heavy',
    );
  });

  test('does not flag a healthy hit rate', () => {
    const events = [
      event({ inputTokens: 1_000, cacheReadTokens: 90_000, cacheWriteTokens: 10_000 }),
    ];
    const result = kinds(events);
    expect(result).not.toContain('cache-miss-heavy');
    expect(result).not.toContain('cache-write-waste');
  });
});

describe('session findings', () => {
  test('detects prompt repeats and model churn, but not drag in short steady sessions', () => {
    const events = [
      event({ model: 'claude-3-opus', prompt: 'fix flaky tests' }),
      event({ model: 'claude-3.5-sonnet', prompt: 'fix flaky tests again' }),
      event({ model: 'claude-3-opus', prompt: 'fix flaky tests please' }),
      event({ model: 'claude-3.5-sonnet', prompt: 'fix flaky tests' }),
    ];
    const result = kinds(events);
    expect(result).toContain('prompt-repeat');
    expect(result).toContain('model-churn');
    expect(result).not.toContain('context-drag');
  });

  test('flags context drag only when late requests carry far more context than early ones', () => {
    const turn = (index: number, context: number) =>
      event({
        sessionId: 'long',
        projectId: '/work/loopcraft',
        timestamp: new Date(Date.parse('2026-05-02T10:00:00.000Z') + index * 60_000).toISOString(),
        inputTokens: 10,
        cacheReadTokens: context,
        outputTokens: 500,
        totalTokens: context + 510,
        pricing: { input: 4, cacheRead: 0.2, cacheWrite: 5 },
      });
    const growing = Array.from({ length: 40 }, (_, i) => turn(i, 40_000 + i * 8_000));
    const drag = report(growing).recommendations.find((r) => r.kind === 'context-drag');
    expect(drag?.evidence.reason).toStartWith('loopcraft: requests grew from');
    expect(drag?.estimatedSavings).toBeGreaterThan(0);

    expect(kinds(Array.from({ length: 40 }, (_, i) => turn(i, 300_000)))).not.toContain(
      'context-drag',
    );
    expect(kinds(growing.slice(0, 10))).not.toContain('context-drag');
  });

  test('lists the ten costliest sessions per kind and rolls up the rest', () => {
    const sessions = Array.from({ length: 14 }, (_, sessionIndex) =>
      Array.from({ length: 40 }, (_, i) =>
        event({
          sessionId: `s${sessionIndex}`,
          timestamp: new Date(Date.parse('2026-05-02T10:00:00.000Z') + i * 60_000).toISOString(),
          inputTokens: 10,
          cacheReadTokens: (40_000 + i * 8_000) * (sessionIndex + 1),
          outputTokens: 500,
          totalTokens: (40_000 + i * 8_000) * (sessionIndex + 1) + 510,
          pricing: { input: 4, cacheRead: 0.2, cacheWrite: 5 },
        }),
      ),
    ).flat();
    const drag = report(sessions).recommendations.filter((r) => r.kind === 'context-drag');

    expect(drag).toHaveLength(11);
    const rollup = drag.find((r) => r.title.includes('more sessions'))!;
    expect(rollup.title).toBe('Context keeps growing (4 more sessions)');
    expect(rollup.evidence.eventCount).toBe(4 * 40);
  });

  test('long low-yield sessions are measured by active time, not wall-clock span', () => {
    const at = (sessionId: string, iso: string) =>
      event({
        sessionId,
        projectId: '/work/app',
        timestamp: iso,
        outputTokens: 10,
        cost: 5,
        totalTokens: 1_000,
      });
    const steady = Array.from({ length: 13 }, (_, i) =>
      at('steady', new Date(Date.parse('2026-05-02T09:00:00.000Z') + i * 5 * 60_000).toISOString()),
    );
    const resumed = [
      at('resumed', '2026-05-02T09:00:00.000Z'),
      at('resumed', '2026-05-04T09:00:00.000Z'),
    ];
    const flagged = report([...steady, ...resumed]).recommendations.filter(
      (r) => r.kind === 'long-session-low-yield',
    );

    expect(flagged.map((r) => r.evidence.sessionId)).toEqual(['steady']);
    expect(flagged[0]!.evidence.reason).toStartWith('app: 60 active minutes produced');
  });

  test('skips prompt signals and says why when prompts were not captured', () => {
    const result = report([
      event({ prompt: undefined }),
      event({ prompt: undefined, sessionId: 's2' }),
    ]);
    expect(result.recommendations.some((r) => r.kind === 'prompt-repeat')).toBe(false);
    expect(result.warnings.some((w) => w.includes('No prompt text'))).toBe(true);
  });
});

describe('spend findings', () => {
  const daily = (date: string, cost: number, model = 'claude-3-opus') =>
    event({
      date,
      timestamp: `${date}T10:00:00.000Z`,
      sessionId: date,
      cost,
      model,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

  test('flags a single model above 85% of spend', () => {
    const concentration = report([
      daily('2026-05-02', 8),
      daily('2026-05-03', 2, 'claude-3.5-sonnet'),
    ]);
    expect(concentration.recommendations.some((r) => r.kind === 'cost-concentration')).toBe(false);

    const result = report([
      daily('2026-05-02', 9.5),
      daily('2026-05-03', 0.5, 'claude-3.5-sonnet'),
    ]);
    const finding = result.recommendations.find((r) => r.kind === 'cost-concentration');
    expect(finding?.title).toBe('High concentration on claude-3-opus');
    expect(finding?.estimatedSavings).toBeNull();
  });

  test('flags a rising trend across the two halves of the window', () => {
    const rising = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04'].map((date, i) =>
      daily(date, i < 2 ? 1 : 2),
    );
    expect(kinds(rising)).toContain('rising-cost');
    const flat = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04'].map((date) =>
      daily(date, 1),
    );
    expect(kinds(flat)).not.toContain('rising-cost');
    expect(kinds(rising.slice(0, 3))).not.toContain('rising-cost');
  });

  test('flags burst days and points at the peak, across a month boundary', () => {
    const events = [daily('2026-04-30', 1), daily('2026-05-01', 40), daily('2026-05-02', 1)];
    const result = buildSavingsReport({
      providers: [provider(events)],
      dateRange: { since: '2026-04-28', until: '2026-05-07' },
      pricing: {},
    });
    const burst = result.recommendations.find((r) => r.kind === 'burst-day');
    expect(burst?.title).toBe('1 burst day');
    expect(burst?.evidence.date).toBe('2026-05-01');
    expect(burst?.recipes[0]?.command).toBe('tokenleak explain 2026-05-01');
  });
});

describe('pricing coverage', () => {
  test('reports full coverage when every token is priced', () => {
    const result = report([event({})]);
    expect(result.summary.pricedTokenShare).toBe(1);
    expect(describePricingGap(result)).toBeNull();
  });

  test('ranks unpriced models by tokens and explains the gap', () => {
    const result = report([
      event({ model: 'mystery-a', unpricedTokens: 1_000, totalTokens: 1_000 }),
      event({ model: 'mystery-b', unpricedTokens: 5_000, totalTokens: 5_000 }),
      event({ totalTokens: 4_000 }),
    ]);
    expect(result.summary.unpricedModels).toEqual(['mystery-b', 'mystery-a']);
    expect(result.summary.pricedTokenShare).toBeCloseTo(0.4);
    expect(describePricingGap(result)).toStartWith(
      '60% of tokens have no known price (mystery-b, mystery-a)',
    );
  });
});

describe('filterBySeverity', () => {
  test('keeps one severity, or everything for all', () => {
    const result = report(
      [event({ inputTokens: 1_000, cacheReadTokens: 50_000, cacheWriteTokens: 200_000 })],
      { pricing },
    );
    expect(filterBySeverity(result, 'all')).toBe(result);
    const medium = filterBySeverity(result, 'medium');
    expect(medium.recommendations.every((r) => r.severity === 'medium')).toBe(true);
    expect(medium.recommendations.length).toBeGreaterThan(0);
  });
});
