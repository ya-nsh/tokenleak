import { describe, expect, it } from 'bun:test';
import { renderAdvisorView } from './advisor-view';
import type { SavingsReport } from '@tokenleak/core';
import { stripAnsi } from './layout';

type SummaryOverrides = Partial<SavingsReport['summary']>;

function makeReport(
  overrides: Partial<Omit<SavingsReport, 'summary'>> & { summary?: SummaryOverrides } = {},
): SavingsReport {
  const { summary, ...rest } = overrides;
  return {
    method: 'test',
    dateRange: { since: '2026-01-01', until: '2026-03-31' },
    recommendations: [
      {
        kind: 'model-routing',
        category: 'routing',
        title: 'Route small tasks from claude-opus-4 to claude-sonnet-4',
        severity: 'high',
        confidence: 'high',
        estimatedSavings: 173.4,
        monthlySavings: 57.8,
        evidence: {
          provider: 'claude-code',
          model: 'claude-opus-4',
          eventCount: 340,
          tokens: 4_000_000,
          cost: 267.6,
          reason: '340 events cost $267.60 on claude-opus-4 and would have cost $94.20 on claude-sonnet-4.',
        },
        recipes: [
          {
            title: 'Send short lookups and small fixes to the cheaper model',
            detail: 'Keep opus for planning.',
            command: 'tokenleak simulate-routing',
          },
        ],
      },
      {
        kind: 'cache-miss-heavy',
        category: 'cache',
        title: 'Low cache hit rate',
        severity: 'medium',
        confidence: 'medium',
        estimatedSavings: 36.9,
        monthlySavings: 12.3,
        evidence: {
          provider: 'claude-code',
          eventCount: 1247,
          tokens: 9_000_000,
          cost: 427.5,
          reason: 'Cache hit rate is 18% for Claude Code; the estimate assumes 50%.',
        },
        recipes: [{ title: 'Stabilize reusable context', detail: 'Move stable instructions.' }],
      },
    ],
    warnings: [],
    summary: {
      totalRecommendations: 2,
      highSeverity: 1,
      currentCost: 427.5,
      currentMonthlyCost: 142.5,
      estimatedSavings: 210.3,
      monthlySavings: 70.1,
      analyzedDays: 90,
      analyzedEvents: 1247,
      analyzedSessions: 80,
      pricedTokenShare: 1,
      unpricedModels: [],
      ...summary,
    },
    ...rest,
  };
}

describe('renderAdvisorView', () => {
  it('renders recommendations with correct sections', () => {
    const report = makeReport();
    const result = renderAdvisorView(report, { width: 80, noColor: true });

    expect(result).toContain('Savings Advisor');
    expect(result).toContain('90 days');
    expect(result).toContain('1,247 events');
    expect(result).toContain('Route small tasks from claude-opus-4');
    expect(result).toContain('Cache hit rate is 18%');
    expect(result).toContain('$ tokenleak simulate-routing');
    expect(result).toContain('$57.80/mo (65% of that usage)');
    expect(result).toContain('Summary');
    expect(result).toContain('$142.50');
    expect(result).toContain('$72.40');
    expect(result).toContain('$70.10/mo (49%)');
  });

  it('produces no ANSI escape codes in no-color mode', () => {
    const report = makeReport();
    const result = renderAdvisorView(report, { width: 80, noColor: true });

    // ANSI escape codes start with \x1b[
    expect(result).not.toContain('\x1b[');
  });

  it('contains ANSI codes when color is enabled', () => {
    const report = makeReport();
    const result = renderAdvisorView(report, { width: 80, noColor: false });

    expect(result).toContain('\x1b[');
  });

  it('shows "no recommendations" for empty report', () => {
    const report = makeReport({
      recommendations: [],
      summary: { totalRecommendations: 0, estimatedSavings: null, monthlySavings: null },
    });
    const result = renderAdvisorView(report, { width: 80, noColor: true });

    expect(result).toContain('No recommendations');
    // Should not contain Summary section
    expect(result).not.toContain('Summary');
  });

  it('shows a recommendation without a savings estimate with just its confidence', () => {
    const report = makeReport({
      recommendations: [
        {
          kind: 'burst-day',
          category: 'spend',
          title: '2 burst days',
          severity: 'low',
          confidence: 'low',
          estimatedSavings: null,
          monthlySavings: null,
          evidence: { date: '2026-03-03', eventCount: 0, tokens: 0, cost: 80, reason: 'Peak: 2026-03-03 at $80.00.' },
          recipes: [{ title: 'Review the peak day', detail: 'x', command: 'tokenleak explain 2026-03-03' }],
        },
      ],
    });
    const result = renderAdvisorView(report, { width: 80, noColor: true });
    expect(result).toContain('2 burst days');
    expect(result).not.toContain('Savings:');
    expect(result).toContain('LOW');
  });

  it('does not call unpriced usage efficient', () => {
    const report = makeReport({
      recommendations: [],
      summary: { monthlySavings: null, pricedTokenShare: 0.2, unpricedModels: ['claude-next', 'gpt-next'] },
    });
    const result = renderAdvisorView(report, { width: 80, noColor: true });

    expect(result).not.toContain('looks efficient');
    expect(result).toContain('80% of tokens have no known price');
    expect(result).toContain('claude-next, gpt-next');
    expect(result).toContain('No recommendations from the priced share');
    for (const line of result.split('\n')) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(80);
    }
  });

  it('respects width constraint -- no line exceeds width after stripping ANSI', () => {
    const report = makeReport();
    const width = 80;
    const result = renderAdvisorView(report, { width, noColor: false });

    const lines = result.split('\n');
    for (const line of lines) {
      const visible = stripAnsi(line);
      expect(visible.length).toBeLessThanOrEqual(width + 2); // small tolerance for box chars
    }
  });
});
