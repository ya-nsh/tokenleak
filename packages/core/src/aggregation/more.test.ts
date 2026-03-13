import { describe, expect, it } from 'bun:test';
import { buildMoreStats, computeModelMixShift } from './more';
import type { ProviderData, UsageEvent } from '../types';

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
      },
    );

    expect(more.compare?.modelMixShift.length).toBeGreaterThan(0);
    expect(more.compare?.previousRange.until).toBe('2026-02-14');
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
});
