import { describe, expect, it } from 'bun:test';
import type { TokenleakOutput, UsageEvent } from '../types';
import { buildWasteReport } from './waste';

function event(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: '2026-04-01T10:00:00.000Z',
    date: '2026-04-01',
    model: 'claude-opus-4',
    inputTokens: 9_000,
    outputTokens: 300,
    cacheReadTokens: 0,
    cacheWriteTokens: 1_000,
    totalTokens: 10_300,
    cost: 2,
    sessionId: 'session-a',
    ...overrides,
  };
}

function output(events: UsageEvent[]): TokenleakOutput {
  return {
    schemaVersion: 1,
    generated: '2026-04-26T00:00:00.000Z',
    dateRange: { since: '2026-04-01', until: '2026-04-26' },
    providers: [
      {
        provider: 'claude-code',
        displayName: 'Claude Code',
        colors: { primary: '#fff', secondary: '#aaa', gradient: ['#111', '#222'] },
        daily: [
          {
            date: '2026-04-01',
            inputTokens: 20_000,
            outputTokens: 900,
            cacheReadTokens: 0,
            cacheWriteTokens: 3_000,
            totalTokens: 40_000,
            cost: 6,
            models: [],
          },
          {
            date: '2026-04-02',
            inputTokens: 1_000,
            outputTokens: 1_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 2_000,
            cost: 0.2,
            models: [],
          },
          {
            date: '2026-04-03',
            inputTokens: 1_000,
            outputTokens: 1_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 2_000,
            cost: 0.2,
            models: [],
          },
          {
            date: '2026-04-04',
            inputTokens: 1_000,
            outputTokens: 1_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 2_000,
            cost: 0.2,
            models: [],
          },
        ],
        totalTokens: 46_000,
        totalCost: 6.6,
        events,
      },
    ],
    aggregated: {
      currentStreak: 3,
      longestStreak: 3,
      rolling30dTokens: 46_000,
      rolling30dCost: 6.6,
      rolling7dTokens: 46_000,
      rolling7dCost: 6.6,
      peakDay: { date: '2026-04-01', tokens: 40_000 },
      averageDailyTokens: 11_500,
      averageDailyCost: 2.13,
      cacheHitRate: 0,
      totalTokens: 46_000,
      totalInputTokens: 22_000,
      totalOutputTokens: 2_900,
      totalCost: 6.6,
      totalDays: 26,
      activeDays: 4,
      dayOfWeek: [],
      topModels: [],
      rolling30dTopModel: 'claude-opus-4',
    },
    more: {
      inputOutput: { inputPerOutput: 9, outputPerInput: 0.11, outputShare: 0.12 },
      monthlyBurn: { projectedTokens: 32_000, projectedCost: 8, observedDays: 26, calendarDays: 30 },
      cacheEconomics: { readTokens: 0, writeTokens: 3_000, readCoverage: 0, reuseRatio: 0 },
      hourOfDay: [],
      sessionMetrics: {
        totalSessions: 1,
        averageTokens: 46_000,
        averageCost: 6.6,
        averageMessages: events.length,
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
  };
}

describe('buildWasteReport', () => {
  it('surfaces deterministic waste categories with recipes', () => {
    const report = buildWasteReport(output([
      event({ timestamp: '2026-04-01T10:00:00.000Z', model: 'claude-opus-4' }),
      event({ timestamp: '2026-04-01T10:05:00.000Z', model: 'claude-sonnet-4' }),
      event({ timestamp: '2026-04-01T10:10:00.000Z', model: 'claude-opus-4' }),
      event({ timestamp: '2026-04-01T10:15:00.000Z', model: 'claude-haiku-4' }),
      event({ timestamp: '2026-04-01T10:20:00.000Z', model: 'claude-opus-4' }),
    ]));

    expect(report.enoughEvidence).toBe(true);
    expect(report.findings.map((finding) => finding.category)).toContain('low-cache-hit-rate');
    expect(report.findings.map((finding) => finding.category)).toContain('wasted-cache-writes');
    expect(report.findings.map((finding) => finding.category)).toContain('context-drag');
    expect(report.findings.map((finding) => finding.category)).toContain('burst-spike');
    expect(report.findings.map((finding) => finding.category)).toContain('model-switch-churn');
    const churn = report.findings.find((finding) => finding.category === 'model-switch-churn');
    expect(churn?.provider).toBe('claude-code');
    expect(churn?.evidence).toContain('claude-code session');
    expect(report.findings[0]?.recipes.length).toBeGreaterThan(0);
  });

  it('does not merge matching session ids across providers for model-switch churn', () => {
    const report = buildWasteReport(output([
      event({
        provider: 'claude-code',
        sessionId: 'shared-session',
        timestamp: '2026-04-01T10:00:00.000Z',
        model: 'claude-opus-4',
      }),
      event({
        provider: 'codex',
        sessionId: 'shared-session',
        timestamp: '2026-04-01T10:05:00.000Z',
        model: 'gpt-5',
      }),
      event({
        provider: 'claude-code',
        sessionId: 'shared-session',
        timestamp: '2026-04-01T10:10:00.000Z',
        model: 'claude-opus-4',
      }),
      event({
        provider: 'codex',
        sessionId: 'shared-session',
        timestamp: '2026-04-01T10:15:00.000Z',
        model: 'gpt-5',
      }),
      event({
        provider: 'claude-code',
        sessionId: 'shared-session',
        timestamp: '2026-04-01T10:20:00.000Z',
        model: 'claude-opus-4',
      }),
    ]));

    expect(report.findings.map((finding) => finding.category)).not.toContain('model-switch-churn');
  });

  it('returns a sparse report instead of failing on empty data', () => {
    const report = buildWasteReport(output([]));

    expect(report.enoughEvidence).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);
  });
});
