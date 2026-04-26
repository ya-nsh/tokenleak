import { describe, expect, it } from 'bun:test';
import type { UsageEvent } from '../types';
import { buildNutritionReport } from './nutrition';

const EVENTS: UsageEvent[] = [
  {
    provider: 'claude-code',
    timestamp: '2026-03-01T10:00:00.000Z',
    date: '2026-03-01',
    model: 'claude-sonnet-4',
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1_500,
    cost: 0.3,
    sessionId: 'session-a',
    repoRoot: '/Users/test/work/app',
  },
  {
    provider: 'cursor',
    timestamp: '2026-03-01T11:00:00.000Z',
    date: '2026-03-01',
    model: 'gpt-5',
    inputTokens: 1_500,
    outputTokens: 1_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2_500,
    cost: 0.7,
    sessionId: 'session-b',
    repoRoot: '/Users/test/work/app',
  },
  {
    provider: 'pi',
    timestamp: '2026-03-02T10:00:00.000Z',
    date: '2026-03-02',
    model: 'pi-fast',
    inputTokens: 700,
    outputTokens: 300,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1_000,
    cost: 0.1,
    projectId: '/Users/test/work/unknown',
  },
];

describe('buildNutritionReport', () => {
  it('joins token usage with read-only outcome signals', () => {
    const report = buildNutritionReport(
      EVENTS,
      [{ repoRoot: '/Users/test/work/app', commits: 2, changedFiles: 4, changedLines: 100 }],
      { since: '2026-03-01', until: '2026-03-31' },
    );

    expect(report.method).toContain('outcome-adjacent');
    expect(report.totals.tokens).toBe(5_000);
    expect(report.totals.commits).toBe(2);
    expect(report.totals.tokensPerCommit).toBe(2_500);
    expect(report.totals.costPerChangedLine).toBeCloseTo(0.011, 4);

    const app = report.repos[0];
    expect(app?.label).toBe('app');
    expect(app?.providers).toEqual(['claude-code', 'cursor']);
    expect(app?.models).toEqual(['claude-sonnet-4', 'gpt-5']);
    expect(app?.sessions).toBe(2);
    expect(app?.tokensPerChangedLine).toBe(40);
  });

  it('keeps missing outcome data explicit instead of fabricating ratios', () => {
    const report = buildNutritionReport(EVENTS, [], { since: '2026-03-01', until: '2026-03-31' });
    const app = report.repos.find((repo) => repo.repoRoot === '/Users/test/work/app');
    const unknown = report.repos.find((repo) => repo.repoRoot === null);

    expect(app?.commits).toBe(0);
    expect(app?.tokensPerCommit).toBeNull();
    expect(unknown?.label).toBe('unknown');
    expect(report.missingOutcomeRepos).toEqual(['/Users/test/work/app']);
  });
});
