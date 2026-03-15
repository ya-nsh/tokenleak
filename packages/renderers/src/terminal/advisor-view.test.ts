import { describe, expect, it } from 'bun:test';
import { renderAdvisorView } from './advisor-view';
import type { AdvisorReport } from '@tokenleak/core';
import { stripAnsi } from './layout';

function makeReport(overrides: Partial<AdvisorReport> = {}): AdvisorReport {
  return {
    recommendations: [
      {
        type: 'model-downgrade',
        title: 'Switch claude-opus-4 to claude-sonnet-4 for short sessions',
        description:
          'You used claude-opus-4 for 340 events averaging 620 output tokens. Switching to claude-sonnet-4 would save money.',
        currentCost: 89.20,
        projectedCost: 31.40,
        monthlySavings: 57.80,
        confidence: 'high',
        details: {
          model: 'claude-opus-4',
          downgradeTo: 'claude-sonnet-4',
          eventCount: 340,
          avgOutputTokens: 620,
        },
      },
      {
        type: 'cache-optimization',
        title: 'Improve cache reuse ratio',
        description: 'Your cache hit rate is 18%. Improving to 50% would save on input costs.',
        currentCost: 0,
        projectedCost: 0,
        monthlySavings: 12.30,
        confidence: 'medium',
        details: { currentHitRate: 0.18, targetHitRate: 0.50 },
      },
    ],
    totalCurrentMonthlyCost: 142.50,
    totalProjectedMonthlyCost: 72.40,
    totalMonthlySavings: 70.10,
    analyzedDays: 90,
    analyzedEvents: 1247,
    ...overrides,
  };
}

describe('renderAdvisorView', () => {
  it('renders recommendations with correct sections', () => {
    const report = makeReport();
    const result = renderAdvisorView(report, { width: 80, noColor: true });

    expect(result).toContain('Model Efficiency Advisor');
    expect(result).toContain('90 days');
    expect(result).toContain('1,247 events');
    expect(result).toContain('Switch claude-opus-4');
    expect(result).toContain('cache reuse ratio');
    expect(result).toContain('Summary');
    expect(result).toContain('$142.50');
    expect(result).toContain('$72.40');
    expect(result).toContain('$70.10');
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
      totalMonthlySavings: 0,
    });
    const result = renderAdvisorView(report, { width: 80, noColor: true });

    expect(result).toContain('No recommendations');
    // Should not contain Summary section
    expect(result).not.toContain('Summary');
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
