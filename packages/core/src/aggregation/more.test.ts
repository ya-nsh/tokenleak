import { describe, expect, it } from 'bun:test';
import { buildMoreStats, computeModelMixShift } from './more';
import { aggregate, buildCompareOutput, mergeProviderData } from '../index';
import type { ProviderData, UsageEvent, ProjectSummary } from '../types';

function createEvents(provider: string = 'claude-code'): UsageEvent[] {
  return [
    {
      provider,
      timestamp: '2026-03-01T09:00:00.000Z',
      date: '2026-03-01',
      model: 'claude-3-opus',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      totalTokens: 190,
      cost: 0.2,
      sessionId: 'session-a',
      projectId: 'project-alpha',
      durationMs: 60_000,
    },
    {
      provider,
      timestamp: '2026-03-01T21:00:00.000Z',
      date: '2026-03-01',
      model: 'claude-3-sonnet',
      inputTokens: 150,
      outputTokens: 75,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      totalTokens: 250,
      cost: 0.25,
      sessionId: 'session-a',
      projectId: 'project-alpha',
      durationMs: 120_000,
    },
    {
      provider,
      timestamp: '2026-03-02T14:00:00.000Z',
      date: '2026-03-02',
      model: 'claude-3-haiku',
      inputTokens: 120,
      outputTokens: 80,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      totalTokens: 215,
      cost: 0.15,
      sessionId: 'session-b',
      projectId: 'project-beta',
      durationMs: 90_000,
    },
  ];
}

function createProvider(overrides: Partial<ProviderData> = {}): ProviderData {
  return {
    provider: 'claude-code',
    displayName: 'Claude Code',
    daily: [
      {
        date: '2026-03-01',
        inputTokens: 250,
        outputTokens: 125,
        cacheReadTokens: 50,
        cacheWriteTokens: 15,
        totalTokens: 440,
        cost: 0.45,
        models: [
          {
            model: 'claude-3-opus',
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 30,
            cacheWriteTokens: 10,
            totalTokens: 190,
            cost: 0.2,
          },
          {
            model: 'claude-3-sonnet',
            inputTokens: 150,
            outputTokens: 75,
            cacheReadTokens: 20,
            cacheWriteTokens: 5,
            totalTokens: 250,
            cost: 0.25,
          },
        ],
      },
      {
        date: '2026-03-02',
        inputTokens: 120,
        outputTokens: 80,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        totalTokens: 215,
        cost: 0.15,
        models: [
          {
            model: 'claude-3-haiku',
            inputTokens: 120,
            outputTokens: 80,
            cacheReadTokens: 10,
            cacheWriteTokens: 5,
            totalTokens: 215,
            cost: 0.15,
          },
        ],
      },
    ],
    totalTokens: 655,
    totalCost: 0.6,
    colors: {
      primary: '#ff6b35',
      secondary: '#ffa366',
      gradient: ['#ff6b35', '#ffa366'],
    },
    events: createEvents(),
    ...overrides,
  };
}

describe('buildMoreStats', () => {
  it('computes efficiency, burn, cache, hour-of-day, and session metrics', () => {
    const provider = createProvider();
    const more = buildMoreStats(
      [provider],
      { since: '2026-03-01', until: '2026-03-14' },
    );

    expect(more.inputOutput.inputPerOutput).toBeCloseTo(370 / 205, 5);
    expect(more.inputOutput.outputPerInput).toBeCloseTo(205 / 370, 5);
    expect(more.cacheEconomics.readTokens).toBe(60);
    expect(more.cacheEconomics.writeTokens).toBe(20);
    expect(more.hourOfDay[9]?.tokens).toBe(190);
    expect(more.hourOfDay[14]?.tokens).toBe(215);
    expect(more.sessionMetrics.totalSessions).toBe(2);
    expect(more.sessionMetrics.topProject?.name).toBe('project-alpha');
    expect(more.sessionMetrics.projectBreakdown).toHaveLength(2);
    expect(more.sessionMetrics.projectBreakdown[0]?.name).toBe('project-alpha');
    expect(more.sessionMetrics.projectBreakdown[1]?.name).toBe('project-beta');
    expect(more.sessionMetrics.projectBreakdown[0]!.tokens).toBeGreaterThan(
      more.sessionMetrics.projectBreakdown[1]!.tokens,
    );
    expect(more.monthlyBurn.calendarDays).toBe(31);
    expect(more.compare).toBeNull();
  });

  it('includes model mix shift details when compare data is supplied', () => {
    const current = createProvider();
    const previous = createProvider({
      daily: [
        {
          date: '2026-02-01',
          inputTokens: 300,
          outputTokens: 120,
          cacheReadTokens: 20,
          cacheWriteTokens: 5,
          totalTokens: 445,
          cost: 0.5,
          models: [
            {
              model: 'claude-3-opus',
              inputTokens: 300,
              outputTokens: 120,
              cacheReadTokens: 20,
              cacheWriteTokens: 5,
              totalTokens: 445,
              cost: 0.5,
            },
          ],
        },
      ],
      events: createEvents(),
    });

    const more = buildMoreStats(
      [current],
      { since: '2026-03-01', until: '2026-03-14' },
      {
        previousRange: { since: '2026-02-01', until: '2026-02-14' },
        previousProviders: [previous],
        previousStats: aggregate(mergeProviderData([previous]), '2026-02-14'),
        deltas: buildCompareOutput(
          { range: { since: '2026-03-01', until: '2026-03-14' }, stats: aggregate(mergeProviderData([current]), '2026-03-14') },
          { range: { since: '2026-02-01', until: '2026-02-14' }, stats: aggregate(mergeProviderData([previous]), '2026-02-14') },
        ).deltas,
      },
    );

    expect(more.compare?.modelMixShift.length).toBeGreaterThan(0);
    expect(more.compare?.previousRange.until).toBe('2026-02-14');
  });

  it('uses UTC hour bucketing so charts stay stable across machine timezones', () => {
    const provider = createProvider({
      events: [
        {
          provider: 'claude-code',
          timestamp: '2026-03-01T00:30:00+05:30',
          date: '2026-03-01',
          model: 'claude-3-opus',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
          cost: 0.1,
          sessionId: 'session-tz',
        },
      ],
    });

    const more = buildMoreStats(
      [provider],
      { since: '2026-03-01', until: '2026-03-14' },
    );

    expect(more.hourOfDay[19]?.tokens).toBe(150);
    expect(more.hourOfDay[0]?.tokens).toBe(0);
  });

  it('returns empty projectBreakdown when no events have projectId', () => {
    const provider = createProvider({
      events: [
        {
          provider: 'claude-code',
          timestamp: '2026-03-01T10:00:00.000Z',
          date: '2026-03-01',
          model: 'claude-3-opus',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
          cost: 0.1,
          sessionId: 'session-no-project',
        },
      ],
    });

    const more = buildMoreStats(
      [provider],
      { since: '2026-03-01', until: '2026-03-14' },
    );

    expect(more.sessionMetrics.projectBreakdown).toHaveLength(0);
    expect(more.sessionMetrics.topProject).toBeNull();
  });

  it('limits projectBreakdown to 10 entries', () => {
    const events: UsageEvent[] = Array.from({ length: 15 }, (_, i) => ({
      provider: 'claude-code',
      timestamp: `2026-03-01T${String(i).padStart(2, '0')}:00:00.000Z`,
      date: '2026-03-01',
      model: 'claude-3-opus',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: (i + 1) * 100,
      cost: 0.1,
      sessionId: `session-${i}`,
      projectId: `project-${i}`,
    }));

    const provider = createProvider({ events });
    const more = buildMoreStats(
      [provider],
      { since: '2026-03-01', until: '2026-03-14' },
    );

    expect(more.sessionMetrics.projectBreakdown).toHaveLength(10);
    expect(more.sessionMetrics.projectBreakdown[0]!.tokens).toBeGreaterThanOrEqual(
      more.sessionMetrics.projectBreakdown[9]!.tokens,
    );
  });

  it('normalizes surrounding whitespace in project ids before bucketing', () => {
    const provider = createProvider({
      events: [
        {
          provider: 'claude-code',
          timestamp: '2026-03-01T10:00:00.000Z',
          date: '2026-03-01',
          model: 'claude-3-opus',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
          cost: 0.1,
          sessionId: 'session-a',
          projectId: 'project-alpha',
        },
        {
          provider: 'claude-code',
          timestamp: '2026-03-01T11:00:00.000Z',
          date: '2026-03-01',
          model: 'claude-3-opus',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 200,
          cost: 0.1,
          sessionId: 'session-b',
          projectId: '  project-alpha  ',
        },
      ],
    });

    const more = buildMoreStats(
      [provider],
      { since: '2026-03-01', until: '2026-03-14' },
    );

    expect(more.sessionMetrics.projectCount).toBe(1);
    expect(more.sessionMetrics.topProject).toEqual({
      name: 'project-alpha',
      tokens: 350,
    } satisfies ProjectSummary);
    expect(more.sessionMetrics.projectBreakdown).toEqual([
      {
        name: 'project-alpha',
        tokens: 350,
      },
    ] satisfies ProjectSummary[]);
  });

  it('upgrades session labels when a later event adds a project id', () => {
    const provider = createProvider({
      events: [
        {
          provider: 'claude-code',
          timestamp: '2026-03-01T10:00:00.000Z',
          date: '2026-03-01',
          model: 'claude-3-opus',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
          cost: 0.1,
          sessionId: 'session-upgrade',
        },
        {
          provider: 'claude-code',
          timestamp: '2026-03-01T11:00:00.000Z',
          date: '2026-03-01',
          model: 'claude-3-opus',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 175,
          cost: 0.1,
          sessionId: 'session-upgrade',
          projectId: 'project-upgraded',
        },
      ],
    });

    const more = buildMoreStats(
      [provider],
      { since: '2026-03-01', until: '2026-03-14' },
    );

    expect(more.sessionMetrics.longestSession?.label).toBe('project-upgraded');
    expect(more.sessionMetrics.topProject?.name).toBe('project-upgraded');
  });
});

describe('computeModelMixShift', () => {
  it('orders models by largest share delta', () => {
    const current = createProvider();
    const previous = createProvider({
      daily: [
        {
          date: '2026-02-01',
          inputTokens: 400,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 500,
          cost: 0.5,
          models: [
            {
              model: 'claude-3-opus',
              inputTokens: 400,
              outputTokens: 100,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 500,
              cost: 0.5,
            },
          ],
        },
      ],
      events: createEvents(),
    });

    const shift = computeModelMixShift([current], [previous], 3);

    expect(shift[0]?.model).toBe('claude-3-opus');
    expect(Math.abs(shift[0]?.deltaShare ?? 0)).toBeGreaterThan(0);
  });

  it('prefers the longest duration session over the highest token session', () => {
    const provider = createProvider({
      events: [
        {
          provider: 'claude-code',
          timestamp: '2026-03-01T10:00:00.000Z',
          date: '2026-03-01',
          model: 'claude-3-opus',
          inputTokens: 500,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 700,
          cost: 0.4,
          sessionId: 'short-heavy',
          projectId: 'project-heavy',
          durationMs: 60_000,
        },
        {
          provider: 'claude-code',
          timestamp: '2026-03-01T12:00:00.000Z',
          date: '2026-03-01',
          model: 'claude-3-haiku',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
          cost: 0.1,
          sessionId: 'long-light',
          projectId: 'project-long',
          durationMs: 600_000,
        },
      ],
    });

    const more = buildMoreStats(
      [provider],
      { since: '2026-03-01', until: '2026-03-14' },
    );

    expect(more.sessionMetrics.longestSession?.label).toBe('project-long');
    expect(more.sessionMetrics.longestSession?.durationMs).toBe(600_000);
  });
});
