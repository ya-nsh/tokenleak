import { describe, expect, it } from 'bun:test';
import type { UsageEvent } from '../types';
import { buildFocusReport } from './focus';

const EVENTS: UsageEvent[] = [
  {
    provider: 'codex',
    timestamp: '2026-03-01T09:00:00.000Z',
    date: '2026-03-01',
    model: 'gpt-5',
    inputTokens: 1_200,
    outputTokens: 800,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2_000,
    cost: 0.6,
    sessionId: 'session-a',
    projectId: '/Users/test/work/project-alpha',
    durationMs: 3_600_000,
  },
  {
    provider: 'codex',
    timestamp: '2026-03-01T10:00:00.000Z',
    date: '2026-03-01',
    model: 'gpt-5',
    inputTokens: 1_500,
    outputTokens: 1_500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 3_000,
    cost: 0.9,
    sessionId: 'session-a',
    projectId: '/Users/test/work/project-alpha',
    durationMs: 1_800_000,
  },
  {
    provider: 'codex',
    timestamp: '2026-03-02T09:00:00.000Z',
    date: '2026-03-02',
    model: 'gpt-5',
    inputTokens: 600,
    outputTokens: 400,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1_000,
    cost: 0.3,
    sessionId: 'session-b',
    projectId: '/Users/test/work/project-alpha',
    durationMs: 1_800_000,
  },
  {
    provider: 'claude-code',
    timestamp: '2026-03-02T12:00:00.000Z',
    date: '2026-03-02',
    model: 'claude-sonnet-4',
    inputTokens: 2_000,
    outputTokens: 2_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 4_000,
    cost: 1.2,
    sessionId: 'session-c',
    projectId: '/Users/test/work/project-beta',
    durationMs: 600_000,
  },
  {
    provider: 'pi',
    timestamp: '2026-03-03T12:00:00.000Z',
    date: '2026-03-03',
    model: 'pi-fast',
    inputTokens: 2_500,
    outputTokens: 3_500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 6_000,
    cost: 0.7,
    sessionId: 'session-d',
  },
];

describe('buildFocusReport', () => {
  it('ranks sessions by the weighted deep-work score', () => {
    const report = buildFocusReport(EVENTS);

    expect(report.method).toContain('Deep-work score');
    expect(report.entries).toHaveLength(4);
    expect(report.entries[0]?.sessionId).toBe('session-a');
    expect(report.entries[0]?.score).toBeGreaterThan(report.entries[1]?.score ?? 0);
    expect(report.entries[0]?.streak).toBe(2);
    expect(report.entries[0]?.tokensPerHour).toBeCloseTo(3333.33, 2);
  });

  it('keeps score breakdowns and rationale for each session', () => {
    const report = buildFocusReport(EVENTS);
    const topSession = report.entries[0];
    const lowSignalSession = report.entries.at(-1);

    expect(topSession?.scoreBreakdown.duration).toBeGreaterThan(0);
    expect(topSession?.rationale).toContain('2-day project streak');
    expect(lowSignalSession?.sessionId).toBe('session-d');
    expect(lowSignalSession?.rationale).toContain('single burst with no measurable active time');
  });

  it('returns an empty report when no events are available', () => {
    expect(buildFocusReport([])).toEqual({
      method: expect.stringContaining('Deep-work score'),
      entries: [],
    });
  });

  it('does not give perfect duration or density scores when every session lacks duration', () => {
    const report = buildFocusReport([
      {
        provider: 'pi',
        timestamp: '2026-03-03T12:00:00.000Z',
        date: '2026-03-03',
        model: 'pi-fast',
        inputTokens: 2500,
        outputTokens: 3500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 6000,
        cost: 0.7,
        sessionId: 'session-x',
      },
      {
        provider: 'pi',
        timestamp: '2026-03-04T12:00:00.000Z',
        date: '2026-03-04',
        model: 'pi-fast',
        inputTokens: 1500,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 2500,
        cost: 0.3,
        sessionId: 'session-y',
      },
    ]);

    expect(report.entries).toHaveLength(2);
    for (const entry of report.entries) {
      expect(entry.scoreBreakdown.duration).toBe(0);
      expect(entry.scoreBreakdown.density).toBe(0);
      expect(entry.rationale).toContain('single burst with no measurable active time');
    }
  });

  it('scores active time, not a session left open for days', () => {
    const at = (iso: string, sessionId: string, totalTokens = 1_000): UsageEvent => ({
      provider: 'claude-code',
      timestamp: iso,
      date: iso.slice(0, 10),
      model: 'claude-opus-5-5',
      inputTokens: totalTokens / 2,
      outputTokens: totalTokens / 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens,
      cost: 0,
      sessionId,
    });
    const resumed = [
      at('2026-03-01T09:00:00.000Z', 'resumed'),
      at('2026-03-01T09:20:00.000Z', 'resumed'),
      at('2026-03-04T09:00:00.000Z', 'resumed'),
      at('2026-03-04T09:20:00.000Z', 'resumed'),
    ];
    const focused = Array.from({ length: 13 }, (_, i) =>
      at(new Date(Date.parse('2026-03-05T09:00:00.000Z') + i * 15 * 60_000).toISOString(), 'focused'),
    );
    const report = buildFocusReport([...resumed, ...focused]);
    const byId = new Map(report.entries.map((entry) => [entry.sessionId, entry]));

    // 3 days of span, 40 minutes of work.
    expect(byId.get('resumed')!.durationMs).toBe(40 * 60_000);
    expect(byId.get('resumed')!.spanMs).toBe(3 * 24 * 3_600_000 + 20 * 60_000);
    // 3 hours of steady 15-minute turns.
    expect(byId.get('focused')!.durationMs).toBe(3 * 3_600_000);
    expect(report.entries[0]!.sessionId).toBe('focused');
  });

  it('does not score density for sessions under ten active minutes', () => {
    const quick = (iso: string): UsageEvent => ({
      provider: 'claude-code',
      timestamp: iso,
      date: '2026-03-06',
      model: 'claude-opus-5-5',
      inputTokens: 50_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 50_000_000,
      cost: 0,
      sessionId: 'quick',
    });
    const report = buildFocusReport([quick('2026-03-06T09:00:00.000Z'), quick('2026-03-06T09:01:00.000Z')]);
    expect(report.entries[0]!.tokensPerHour).toBe(0);
    expect(report.entries[0]!.rationale).toContain('too short for a density signal');
  });
});

describe('activeDurationMs', () => {
  const { activeDurationMs, FOCUS_IDLE_GAP_MS } = require('./focus') as typeof import('./focus');

  it('sums gaps up to the idle threshold and skips longer breaks', () => {
    expect(activeDurationMs(['2026-01-01T10:00:00Z', '2026-01-01T10:30:00Z', '2026-01-01T12:00:00Z'])).toBe(
      FOCUS_IDLE_GAP_MS,
    );
  });

  it('ignores order and invalid timestamps', () => {
    expect(activeDurationMs(['2026-01-01T10:10:00Z', 'nope', '2026-01-01T10:00:00Z'])).toBe(10 * 60_000);
  });

  it('a single event has no active time', () => {
    expect(activeDurationMs(['2026-01-01T10:00:00Z'])).toBe(0);
    expect(activeDurationMs([])).toBe(0);
  });
});
