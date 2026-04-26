import { describe, expect, it } from 'bun:test';
import type { TokenleakOutput } from '../types';
import { buildCommonsExport, buildCommonsPromptExport, inspectCommonsExport } from './commons';

const OUTPUT: TokenleakOutput = {
  schemaVersion: 1,
  generated: '2026-04-26T00:00:00.000Z',
  dateRange: { since: '2026-04-01', until: '2026-04-26' },
  providers: [
    {
      provider: 'claude-code',
      displayName: 'Claude Code',
      colors: { primary: '#fff', secondary: '#aaa', gradient: ['#111', '#222'] },
      totalTokens: 12_000,
      totalCost: 1.25,
      daily: [
        {
          date: '2026-04-25',
          inputTokens: 8_000,
          outputTokens: 2_000,
          cacheReadTokens: 2_000,
          cacheWriteTokens: 0,
          totalTokens: 12_000,
          cost: 1.25,
          models: [
            {
              model: 'claude-sonnet-4',
              inputTokens: 8_000,
              outputTokens: 2_000,
              cacheReadTokens: 2_000,
              cacheWriteTokens: 0,
              totalTokens: 12_000,
              cost: 1.25,
            },
          ],
        },
      ],
      events: [
        {
          provider: 'claude-code',
          timestamp: '2026-04-25T10:12:00.000Z',
          date: '2026-04-25',
          model: 'claude-sonnet-4',
          inputTokens: 8_000,
          outputTokens: 2_000,
          cacheReadTokens: 2_000,
          cacheWriteTokens: 0,
          totalTokens: 12_000,
          cost: 1.25,
          sessionId: 'secret-session-id',
          projectId: '/Users/alice/work/private-repo',
          repoRoot: '/Users/alice/work/private-repo',
          directory: 'src',
        },
      ],
    },
  ],
  aggregated: {
    currentStreak: 1,
    longestStreak: 1,
    rolling30dTokens: 12_000,
    rolling30dCost: 1.25,
    rolling7dTokens: 12_000,
    rolling7dCost: 1.25,
    peakDay: { date: '2026-04-25', tokens: 12_000 },
    averageDailyTokens: 12_000,
    averageDailyCost: 1.25,
    cacheHitRate: 0.2,
    totalTokens: 12_000,
    totalInputTokens: 8_000,
    totalOutputTokens: 2_000,
    totalCost: 1.25,
    totalDays: 26,
    activeDays: 1,
    dayOfWeek: [{ day: 6, label: 'Sat', tokens: 12_000, cost: 1.25, count: 1 }],
    topModels: [{ model: 'claude-sonnet-4', tokens: 12_000, cost: 1.25, percentage: 1 }],
    rolling30dTopModel: 'claude-sonnet-4',
  },
  more: {
    inputOutput: { inputPerOutput: 4, outputPerInput: 0.25, outputShare: 0.2 },
    monthlyBurn: { projectedTokens: 14_400, projectedCost: 1.5, observedDays: 25, calendarDays: 30 },
    cacheEconomics: { readTokens: 2_000, writeTokens: 0, readCoverage: 0.2, reuseRatio: null },
    hourOfDay: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      tokens: hour === 10 ? 12_000 : 0,
      cost: hour === 10 ? 1.25 : 0,
      count: hour === 10 ? 1 : 0,
    })),
    sessionMetrics: {
      totalSessions: 1,
      averageTokens: 12_000,
      averageCost: 1.25,
      averageMessages: 1,
      averageDurationMs: null,
      longestSession: null,
      projectCount: 1,
      topProject: { name: '/Users/alice/work/private-repo', tokens: 12_000 },
      projectBreakdown: [{ name: '/Users/alice/work/private-repo', tokens: 12_000 }],
    },
    sessionDrilldown: [
      {
        sessionId: 'secret-session-id',
        label: 'secret-session-id',
        provider: 'claude-code',
        projectId: '/Users/alice/work/private-repo',
        repoRoot: '/Users/alice/work/private-repo',
        directory: 'src',
        start: '2026-04-25T10:12:00.000Z',
        end: '2026-04-25T10:12:00.000Z',
        durationMs: null,
        eventCount: 1,
        inputTokens: 8_000,
        outputTokens: 2_000,
        cacheReadTokens: 2_000,
        cacheWriteTokens: 0,
        totalTokens: 12_000,
        cost: 1.25,
        topModels: [],
      },
    ],
    projectDrilldown: [
      {
        projectId: '/Users/alice/work/private-repo',
        repoRoot: '/Users/alice/work/private-repo',
        directory: 'src',
        sessionCount: 1,
        activeDays: 1,
        streak: 1,
        inputTokens: 8_000,
        outputTokens: 2_000,
        cacheReadTokens: 2_000,
        cacheWriteTokens: 0,
        totalTokens: 12_000,
        cost: 1.25,
        topModels: [],
        topSessions: [],
      },
    ],
    compare: null,
  },
};

describe('buildCommonsExport', () => {
  it('exports aggregate buckets without local identifiers', () => {
    const exportData = buildCommonsExport(OUTPUT);
    const serialized = JSON.stringify(exportData);

    expect(exportData.privacy).toEqual({
      containsPrompts: false,
      containsPaths: false,
      containsRepoNames: false,
      containsSessionIds: false,
      containsExactTimestamps: false,
      granularity: 'aggregate-v1',
    });
    expect(serialized).not.toContain('/Users/alice');
    expect(serialized).not.toContain('private-repo');
    expect(serialized).not.toContain('secret-session-id');
    expect(serialized).not.toContain('2026-04-25T10:12:00.000Z');
    expect(exportData.providerModels[0]?.tokensBucket).toBe('10000-19999');
  });

  it('validates the exported shape for pre-share inspection', () => {
    const exportData = buildCommonsExport(OUTPUT);
    const report = inspectCommonsExport(exportData);

    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.summary.providerModels).toBe(1);
  });

  it('builds an LLM-ready prompt without local identifiers', () => {
    const prompt = buildCommonsPromptExport(buildCommonsExport(OUTPUT));

    expect(prompt).toContain('# Tokenleak LLM Analysis Prompt');
    expect(prompt).toContain('## Privacy Guarantees');
    expect(prompt).toContain('## Analysis Goals');
    expect(prompt).toContain('```json');
    expect(prompt).toContain('"containsPrompts": false');
    expect(prompt).not.toContain('/Users/alice');
    expect(prompt).not.toContain('private-repo');
    expect(prompt).not.toContain('secret-session-id');
    expect(prompt).not.toContain('2026-04-25T10:12:00.000Z');
  });
});
