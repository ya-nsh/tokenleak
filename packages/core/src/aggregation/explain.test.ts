import { describe, expect, it } from 'bun:test';
import type { ModelBreakdown, ProviderData, ProviderColors, UsageEvent } from '../types';
import { buildExplainReport } from './explain';

const COLORS: ProviderColors = {
  primary: '#111111',
  secondary: '#222222',
  gradient: ['#111111', '#222222'],
};

function createModels(entries: Array<{ model: string; tokens: number; cost: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number }>): ModelBreakdown[] {
  return entries.map((entry) => ({
    model: entry.model,
    inputTokens: entry.input ?? entry.tokens,
    outputTokens: entry.output ?? 0,
    cacheReadTokens: entry.cacheRead ?? 0,
    cacheWriteTokens: entry.cacheWrite ?? 0,
    totalTokens: entry.tokens,
    cost: entry.cost,
  }));
}

function createProvider(
  provider: string,
  displayName: string,
  daily: ProviderData['daily'],
  events: UsageEvent[],
): ProviderData {
  return {
    provider,
    displayName,
    daily,
    totalTokens: daily.reduce((sum, day) => sum + day.totalTokens, 0),
    totalCost: daily.reduce((sum, day) => sum + day.cost, 0),
    colors: COLORS,
    events,
  };
}

const TARGET_DATE = '2026-03-10';

function buildTrailingDaily(
  targetDate: string,
  count: number,
  buildDay: (date: string) => ProviderData['daily'][number],
): ProviderData['daily'] {
  const target = new Date(`${targetDate}T00:00:00Z`);
  const days: ProviderData['daily'] = [];

  for (let offset = count; offset >= 1; offset--) {
    const date = new Date(target);
    date.setUTCDate(date.getUTCDate() - offset);
    days.push(buildDay(date.toISOString().slice(0, 10)));
  }

  return days;
}

const codexDaily = buildTrailingDaily(TARGET_DATE, 30, (date) => ({
    date,
    inputTokens: 700,
    outputTokens: 200,
    cacheReadTokens: 600,
    cacheWriteTokens: 0,
    totalTokens: 1_500,
    cost: 1.2,
    models: createModels([
      { model: 'gpt-5', tokens: 1_000, cost: 0.8, input: 500, output: 100, cacheRead: 400 },
      { model: 'o4-mini', tokens: 500, cost: 0.4, input: 200, output: 100, cacheRead: 200 },
    ]),
  })).concat([
  {
    date: TARGET_DATE,
    inputTokens: 11_000,
    outputTokens: 7_000,
    cacheReadTokens: 1_000,
    cacheWriteTokens: 0,
    totalTokens: 19_000,
    cost: 18,
    models: createModels([
      { model: 'gpt-5', tokens: 16_000, cost: 15, input: 9_000, output: 6_000, cacheRead: 1_000 },
      { model: 'o4-mini', tokens: 3_000, cost: 3, input: 2_000, output: 1_000 },
    ]),
  },
]);

const claudeDaily = buildTrailingDaily(TARGET_DATE, 30, (date) => ({
    date,
    inputTokens: 600,
    outputTokens: 300,
    cacheReadTokens: 300,
    cacheWriteTokens: 0,
    totalTokens: 1_200,
    cost: 1,
    models: createModels([
      { model: 'claude-sonnet-4', tokens: 1_200, cost: 1, input: 600, output: 300, cacheRead: 300 },
    ]),
  })).concat([
  {
    date: TARGET_DATE,
    inputTokens: 1_200,
    outputTokens: 600,
    cacheReadTokens: 200,
    cacheWriteTokens: 0,
    totalTokens: 2_000,
    cost: 2,
    models: createModels([
      { model: 'claude-sonnet-4', tokens: 2_000, cost: 2, input: 1_200, output: 600, cacheRead: 200 },
    ]),
  },
]);

const targetEvents: UsageEvent[] = [
  {
    provider: 'codex',
    timestamp: '2026-03-10T08:00:00.000Z',
    date: TARGET_DATE,
    model: 'gpt-5',
    inputTokens: 4_000,
    outputTokens: 1_500,
    cacheReadTokens: 500,
    cacheWriteTokens: 0,
    totalTokens: 6_000,
    cost: 5.5,
    sessionId: 'session-long',
    projectId: '/Users/test/work/tokenleak/apps/web',
    directory: 'apps',
    durationMs: 7_200_000,
  },
  {
    provider: 'codex',
    timestamp: '2026-03-10T10:00:00.000Z',
    date: TARGET_DATE,
    model: 'gpt-5',
    inputTokens: 5_000,
    outputTokens: 4_500,
    cacheReadTokens: 500,
    cacheWriteTokens: 0,
    totalTokens: 10_000,
    cost: 9.5,
    sessionId: 'session-long',
    projectId: '/Users/test/work/tokenleak/apps/web',
    directory: 'apps',
    durationMs: 5_400_000,
  },
  {
    provider: 'codex',
    timestamp: '2026-03-10T13:00:00.000Z',
    date: TARGET_DATE,
    model: 'o4-mini',
    inputTokens: 2_000,
    outputTokens: 1_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 3_000,
    cost: 3,
    sessionId: 'session-dense',
    projectId: '/Users/test/work/tokenleak/apps/api',
    directory: 'api',
    durationMs: 240_000,
  },
  {
    provider: 'claude-code',
    timestamp: '2026-03-10T15:00:00.000Z',
    date: TARGET_DATE,
    model: 'claude-sonnet-4',
    inputTokens: 1_200,
    outputTokens: 600,
    cacheReadTokens: 200,
    cacheWriteTokens: 0,
    totalTokens: 2_000,
    cost: 2,
    sessionId: 'session-claude',
    projectId: '/Users/test/work/tokenleak/packages/core',
    directory: 'packages',
    durationMs: 3_600_000,
  },
];

describe('buildExplainReport', () => {
  it('builds a deterministic narrative, evidence rows, and anomaly flags', () => {
    const providers = [
      createProvider('codex', 'Codex', codexDaily, targetEvents.filter((event) => event.provider === 'codex')),
      createProvider('claude-code', 'Claude Code', claudeDaily, targetEvents.filter((event) => event.provider === 'claude-code')),
    ];

    const report = buildExplainReport(providers, TARGET_DATE);

    expect(report.date).toBe(TARGET_DATE);
    expect(report.totalTokens).toBe(21_000);
    expect(report.headline).toBe('Spike day on 2026-03-10 led by Codex');
    expect(report.summary[0]).toContain('21.0K tokens');
    expect(report.summary[1]).toContain('Codex contributed 90%');
    expect(report.topProviders.map((entry) => entry.label)).toEqual(['Codex', 'Claude Code']);
    expect(report.topModels[0]).toMatchObject({ label: 'gpt-5', tokens: 16_000 });
    expect(report.topSessions[0]?.label).toBe('codex:apps');
    expect(report.topProjects[0]?.label).toBe('apps');
    expect(report.anomalies.map((entry) => entry.type)).toEqual([
      'provider-spike',
      'model-spike',
      'cache-drop',
      'long-session',
      'dense-session',
    ]);
  });

  it('returns an empty-day report when the target date has no usage', () => {
    const providers = [
      createProvider('codex', 'Codex', codexDaily, []),
    ];

    const report = buildExplainReport(providers, '2026-03-11');

    expect(report.totalTokens).toBe(0);
    expect(report.headline).toBe('No recorded token activity on 2026-03-11');
    expect(report.topProviders).toEqual([]);
    expect(report.anomalies).toEqual([]);
    expect(report.summary[0]).toContain('No provider reported activity');
  });
});
