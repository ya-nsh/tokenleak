import { describe, expect, it } from 'bun:test';
import { stripAnsi } from '../layout';
import {
  createOutput,
  createMoreStats,
  createRenderOptions,
  createPopulatedStats,
} from '../../__test-fixtures__';
import { renderTabBar } from './tab-bar';
import { renderOverviewView } from './overview-view';
import { renderCompareView } from './compare-view';
import { renderProviderView } from './provider-view';
import { renderDowView } from './dow-view';
import { renderTodView } from './tod-view';
import { renderSessionView } from './session-view';
import { renderModelView } from './model-view';
import { renderTokenView } from './token-view';
import { renderCwdView } from './cwd-view';

describe('renderTabBar', () => {
  it('renders both range and tab sections', () => {
    const result = renderTabBar('30d', 'overview', 120, false);
    expect(result).toContain('30d');
    expect(result).toContain('overview');
    expect(result).toContain('delta');
    expect(result).toContain('provider');
    expect(result).toContain('sess');
    expect(result).toContain('scroll');
  });

  it('produces no ANSI codes with noColor', () => {
    const result = renderTabBar('7d', 'tok', 100, true);
    expect(stripAnsi(result)).toBe(result);
  });

  it('handles narrow widths', () => {
    const result = renderTabBar('90d', 'dow', 40, true);
    for (const line of result.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('renderOverviewView', () => {
  it('returns the full dashboard string', () => {
    const output = createOutput();
    const options = createRenderOptions({ format: 'terminal', width: 80, noColor: true });
    const result = renderOverviewView(output, options);
    expect(result).toContain('Tokenleak');
  });
});

describe('renderCompareView', () => {
  it('renders compare metrics and model mix shift', () => {
    const output = createOutput({
      more: createMoreStats({
        compare: {
          previousRange: { since: '2025-12-01', until: '2025-12-31' },
          previousStats: createPopulatedStats({
            totalTokens: 70000,
            totalCost: 2.5,
            activeDays: 20,
            currentStreak: 3,
            averageDailyTokens: 1800,
            cacheHitRate: 0.28,
          }),
          deltas: {
            tokens: 30000,
            cost: 1.5,
            streak: 2,
            activeDays: 10,
            averageDailyTokens: 700,
            cacheHitRate: 0.14,
          },
          modelMixShift: [
            {
              model: 'claude-3-opus',
              currentShare: 0.5,
              previousShare: 0.34,
              deltaShare: 0.16,
              currentTokens: 50000,
              previousTokens: 24000,
            },
          ],
        },
      }),
    });
    const result = renderCompareView(output, 96, true);

    expect(result).toContain('Compare');
    expect(result).toContain('Model Mix Shift');
    expect(result).toContain('claude-3-opus');
    expect(result).toContain('Total Tokens');
  });

  it('shows an empty state without compare data', () => {
    const output = createOutput({ more: createMoreStats({ compare: null }) });
    const result = renderCompareView(output, 80, true);
    expect(result).toContain('No compare data available');
  });
});

describe('renderDowView', () => {
  it('renders bars for each active day', () => {
    const output = createOutput();
    const result = renderDowView(output, 80, false);
    expect(result).toContain('Day of Week');
    expect(result).toContain('Mon');
  });

  it('handles empty dayOfWeek', () => {
    const output = createOutput({ aggregated: createPopulatedStats({ dayOfWeek: [] }) });
    const result = renderDowView(output, 80, false);
    expect(result).toContain('No day-of-week data');
  });

  it('produces no ANSI codes with noColor', () => {
    const output = createOutput();
    const result = renderDowView(output, 80, true);
    expect(stripAnsi(result)).toBe(result);
  });

  it('does not render a filled bar for zero-token days', () => {
    const output = createOutput({
      aggregated: createPopulatedStats({
        dayOfWeek: [
          { day: 0, label: 'Sunday', tokens: 100, cost: 1, count: 1 },
          { day: 1, label: 'Monday', tokens: 0, cost: 0, count: 0 },
        ],
      }),
    });
    const result = stripAnsi(renderDowView(output, 80, false));

    expect(result).toContain('Mon');
    expect(result).toContain('0%');
    expect(result).not.toContain('Mon   █');
  });
});

describe('renderTodView', () => {
  it('renders time-of-day buckets', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderTodView(output, 80, false);
    expect(result).toContain('Time of Day');
    expect(result).toContain('Morning');
    expect(result).toContain('Evening');
  });

  it('handles missing more stats', () => {
    const output = createOutput({ more: null });
    const result = renderTodView(output, 80, false);
    expect(result).toContain('No event-level data');
  });

  it('produces no ANSI codes with noColor', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderTodView(output, 80, true);
    expect(stripAnsi(result)).toBe(result);
  });
});

describe('renderSessionView', () => {
  it('renders session metrics', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderSessionView(output, 80, false);
    expect(result).toContain('Sessions');
    expect(result).toContain('sessions');
    expect(result).toContain('avg/session');
  });

  it('handles missing more stats', () => {
    const output = createOutput({ more: null });
    const result = renderSessionView(output, 80, false);
    expect(result).toContain('No event-level data');
  });

  it('shows longest session when available', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderSessionView(output, 80, true);
    expect(result).toContain('Longest Session');
    expect(result).toContain('project-alpha');
  });

  it('produces no ANSI codes with noColor', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderSessionView(output, 80, true);
    expect(stripAnsi(result)).toBe(result);
  });
});

describe('renderModelView', () => {
  it('renders model bars', () => {
    const output = createOutput();
    const result = renderModelView(output, 80, false);
    expect(result).toContain('Models');
    expect(result).toContain('claude-3-opus');
  });

  it('handles empty models', () => {
    const output = createOutput({ aggregated: createPopulatedStats({ topModels: [] }) });
    const result = renderModelView(output, 80, false);
    expect(result).toContain('No model data');
  });

  it('shows input/output ratio when more stats present', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderModelView(output, 80, true);
    expect(result).toContain('Input / Output');
  });

  it('produces no ANSI codes with noColor', () => {
    const output = createOutput();
    const result = renderModelView(output, 80, true);
    expect(stripAnsi(result)).toBe(result);
  });
});

describe('renderTokenView', () => {
  it('renders token stats and heatmap', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderTokenView(output, 80, false);
    expect(result).toContain('Tokens');
    expect(result).toContain('Heatmap');
    expect(result).toContain('Cache Economics');
  });

  it('shows burn projection', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderTokenView(output, 80, true);
    expect(result).toContain('Monthly Burn');
    expect(result).toContain('Projected');
  });

  it('produces no ANSI codes with noColor', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderTokenView(output, 80, true);
    expect(stripAnsi(result)).toBe(result);
  });
});

describe('renderCwdView', () => {
  it('renders project bars', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderCwdView(output, 80, false);
    expect(result).toContain('Projects');
    expect(result).toContain('project-alpha');
  });

  it('handles missing more stats', () => {
    const output = createOutput({ more: null });
    const result = renderCwdView(output, 80, false);
    expect(result).toContain('No event-level data');
  });

  it('handles empty projectBreakdown', () => {
    const output = createOutput({
      more: createMoreStats({
        sessionMetrics: {
          totalSessions: 0,
          averageTokens: 0,
          averageCost: 0,
          averageMessages: 0,
          averageDurationMs: null,
          longestSession: null,
          projectCount: 0,
          topProject: null,
          projectBreakdown: [],
        },
      }),
    });
    const result = renderCwdView(output, 80, false);
    expect(result).toContain('No event-level data');
  });

  it('produces no ANSI codes with noColor', () => {
    const output = createOutput({ more: createMoreStats() });
    const result = renderCwdView(output, 80, true);
    expect(stripAnsi(result)).toBe(result);
  });
});

describe('renderProviderView', () => {
  it('renders provider totals and last active dates', () => {
    const output = createOutput({
      providers: [
        createOutput().providers[0]!,
        {
          ...createOutput().providers[0]!,
          provider: 'codex',
          displayName: 'Codex',
        },
      ],
    });
    const result = renderProviderView(output, 96, true);

    expect(result).toContain('Providers');
    expect(result).toContain('Claude Code');
    expect(result).toContain('Codex');
    expect(result).toContain('last active');
  });

  it('handles no provider activity', () => {
    const output = createOutput({ providers: [] });
    const result = renderProviderView(output, 80, true);
    expect(result).toContain('No provider activity');
  });
});
