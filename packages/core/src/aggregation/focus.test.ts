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
    expect(lowSignalSession?.rationale).toContain('single-event session with no duration signal');
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
      expect(entry.rationale).toContain('single-event session with no duration signal');
    }
  });
});
