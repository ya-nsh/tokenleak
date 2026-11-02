import { describe, expect, it } from 'bun:test';
import type { ProviderData, UsageEvent } from '../types';
import { formatCostWithCompleteness } from '../cost-completeness';
import { buildNutritionReport } from './nutrition';
import { buildReplayReport } from './replay';
import { buildSessionRollups } from './analytics';

function event(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: '2026-10-01T10:00:00.000Z',
    date: '2026-10-01',
    model: 'claude-opus-5-5',
    inputTokens: 100,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 200,
    cost: 1,
    costSource: 'estimated',
    sessionId: 's1',
    projectId: '/work/app',
    ...overrides,
  };
}

const unpriced = (overrides: Partial<UsageEvent> = {}) =>
  event({ model: 'mystery', cost: 0, costSource: 'unpriced', unpricedTokens: 200, ...overrides });

function provider(events: UsageEvent[]): ProviderData {
  return {
    provider: 'claude-code',
    displayName: 'Claude Code',
    daily: [],
    totalTokens: events.reduce((sum, e) => sum + e.totalTokens, 0),
    totalCost: events.reduce((sum, e) => sum + e.cost, 0),
    colors: { primary: '#000', secondary: '#000', gradient: ['#000', '#000'] },
    events,
  };
}

describe('report rows carry cost completeness', () => {
  it('session rollups mark unpriced and partially priced sessions', () => {
    const rollups = buildSessionRollups([
      unpriced({ sessionId: 'a' }),
      event({ sessionId: 'b' }),
      unpriced({ sessionId: 'b', timestamp: '2026-10-01T10:05:00.000Z' }),
    ]);
    const byId = new Map(rollups.map((r) => [r.sessionId, r]));
    expect(formatCostWithCompleteness(byId.get('a')!.cost, byId.get('a')!.costCompleteness)).toBe('Unknown');
    expect(formatCostWithCompleteness(byId.get('b')!.cost, byId.get('b')!.costCompleteness)).toBe('$1.00+');
  });

  it('replay flow blocks say Unknown instead of $0.00', () => {
    const report = buildReplayReport([provider([unpriced()])], '2026-10-01');
    const block = report.flowBlocks[0]!;
    expect(formatCostWithCompleteness(block.cost, block.costCompleteness)).toBe('Unknown');
  });

  it('AI ROI repos and totals carry completeness', () => {
    const report = buildNutritionReport([event({}), unpriced({ projectId: '/work/other' })], [], {
      since: '2026-10-01',
      until: '2026-10-01',
    });
    const statuses = report.repos.map((repo) => repo.costCompleteness?.status).sort();
    expect(statuses).toEqual(['complete', 'unknown']);
    expect(report.totals.costCompleteness?.status).toBe('partial');
  });

  it('a fully priced row stays complete', () => {
    const [session] = buildSessionRollups([event({})]);
    expect(session!.costCompleteness?.status).toBe('complete');
  });
});
