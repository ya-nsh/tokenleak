import { describe, expect, test } from 'bun:test';
import type {
  BehaviorCohortSelector,
  DateRange,
  UsageEvent,
} from '../types';
import {
  buildAgentBehaviorDiffReport,
} from './index';
import { buildRoutingSimulationReport } from '../savings/routing-simulator';

const range: DateRange = { since: '2026-05-01', until: '2026-05-07' };

const pricing = {
  'claude-3-opus': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-3.5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
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
    costSource: 'provider-reported',
    sessionId: 's1',
    projectId: '/work/repo',
    repoRoot: '/work/repo',
    durationMs: 120_000,
    prompt: 'fix the lint error',
    ...overrides,
  };
}

describe('buildRoutingSimulationReport', () => {
  test('simulates downgrade savings with cache-aware pricing and sparse confidence', () => {
    const report = buildRoutingSimulationReport(
      [event({ sessionId: 's1' }), event({ sessionId: 's2', timestamp: '2026-05-02T10:05:00.000Z' })],
      range,
      pricing,
      { strategy: 'conservative' },
    );

    expect(report.strategy).toBe('conservative');
    expect(report.affectedEvents).toBe(2);
    expect(report.estimatedSavings).toBeGreaterThan(0);
    expect(report.simulatedCost).toBeLessThan(report.currentCost);
    expect(report.candidates[0]?.toModel).toBe('claude-3.5-sonnet');
    expect(report.candidates[0]?.confidence).toBe('low');
    expect(report.candidates[0]?.reasons).toContain('provider reported current cost');
  });

  test('warns and skips malformed and unknown-priced events', () => {
    const report = buildRoutingSimulationReport(
      [
        event({ inputTokens: -1, totalTokens: 10 }),
        event({ model: 'mystery-premium', pricing: null, costSource: 'unpriced' }),
      ],
      range,
      pricing,
    );

    expect(report.affectedEvents).toBe(0);
    expect(report.warnings.some((w) => w.includes('negative token counts'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('No downgrade path'))).toBe(true);
  });
});

describe('buildAgentBehaviorDiffReport', () => {
  test('compares provider cohorts and produces deterministic takeaways', () => {
    const events = [
      event({ provider: 'claude-code', model: 'claude-3-opus', sessionId: 'c1', cost: 2, inputTokens: 20_000, outputTokens: 500, totalTokens: 20_500 }),
      event({ provider: 'codex', model: 'gpt-4o', sessionId: 'x1', cost: 0.4, inputTokens: 4_000, outputTokens: 700, totalTokens: 4_700 }),
      event({ provider: 'codex', model: 'gpt-4o', sessionId: 'x2', cost: 0.3, inputTokens: 3_000, outputTokens: 600, totalTokens: 3_600 }),
    ];
    const baseline: BehaviorCohortSelector = {
      label: 'Claude',
      dimension: 'provider',
      provider: 'claude-code',
    };
    const comparison: BehaviorCohortSelector = {
      label: 'Codex',
      dimension: 'provider',
      provider: 'codex',
    };

    const report = buildAgentBehaviorDiffReport(events, range, baseline, comparison);

    expect(report.baseline.metrics.events).toBe(1);
    expect(report.comparison.metrics.events).toBe(2);
    expect(report.deltas.cost).toBeCloseTo(-1.3);
    expect(report.takeaways.some((line) => line.includes('Codex'))).toBe(true);
  });

  test('warns on empty and identical cohorts instead of throwing', () => {
    const selector: BehaviorCohortSelector = {
      label: 'Missing',
      dimension: 'provider',
      provider: 'missing',
    };
    const report = buildAgentBehaviorDiffReport([event({})], range, selector, selector);

    expect(report.baseline.metrics.events).toBe(0);
    expect(report.comparison.metrics.events).toBe(0);
    expect(report.deltas.cost).toBeNull();
    expect(report.warnings.some((w) => w.includes('identical'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('Baseline cohort is empty'))).toBe(true);
  });
});
