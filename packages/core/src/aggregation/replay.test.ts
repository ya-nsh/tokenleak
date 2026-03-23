import { describe, expect, it } from 'bun:test';
import type { ProviderColors, ProviderData, UsageEvent } from '../types';
import { buildReplayReport } from './replay';

const COLORS: ProviderColors = {
  primary: '#111111',
  secondary: '#222222',
  gradient: ['#111111', '#222222'],
};

const TARGET_DATE = '2026-03-10';

function makeEvent(overrides: Partial<UsageEvent> & { timestamp: string }): UsageEvent {
  return {
    provider: 'claude-code',
    date: overrides.timestamp.slice(0, 10),
    model: 'claude-sonnet-4',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
    totalTokens: 1800,
    cost: 0.01,
    ...overrides,
  };
}

function makeProvider(events: UsageEvent[]): ProviderData {
  return {
    provider: 'claude-code',
    displayName: 'Claude Code',
    daily: [],
    totalTokens: events.reduce((sum, e) => sum + e.totalTokens, 0),
    totalCost: events.reduce((sum, e) => sum + e.cost, 0),
    colors: COLORS,
    events,
  };
}

describe('buildReplayReport', () => {
  it('returns zeroed report for empty day', () => {
    const report = buildReplayReport([], TARGET_DATE);

    expect(report.date).toBe(TARGET_DATE);
    expect(report.events).toHaveLength(0);
    expect(report.flowBlocks).toHaveLength(0);
    expect(report.tokenVelocity).toHaveLength(0);
    expect(report.summary.totalSessions).toBe(0);
    expect(report.summary.totalEvents).toBe(0);
    expect(report.summary.flowTimeMs).toBe(0);
    expect(report.summary.thinkTimeMs).toBe(0);
    expect(report.summary.flowThinkRatio).toBe(0);
    expect(report.summary.peakMinute).toBeNull();
  });

  it('creates one Quick Lookup block for a single event', () => {
    const event = makeEvent({ timestamp: `${TARGET_DATE}T10:00:00Z`, sessionId: 's1' });
    const report = buildReplayReport([makeProvider([event])], TARGET_DATE);

    expect(report.events).toHaveLength(1);
    expect(report.flowBlocks).toHaveLength(1);
    expect(report.flowBlocks[0].label).toBe('Quick Lookup');
    expect(report.flowBlocks[0].eventCount).toBe(1);
    expect(report.flowBlocks[0].durationMs).toBe(0);
    expect(report.summary.totalSessions).toBe(1);
  });

  it('groups events within 15 minutes into one block', () => {
    const events = [
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:00Z` }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:05:00Z` }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:10:00Z` }),
    ];
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.flowBlocks).toHaveLength(1);
    expect(report.flowBlocks[0].eventCount).toBe(3);
    expect(report.flowBlocks[0].durationMs).toBe(10 * 60 * 1000);
  });

  it('splits into two blocks when gap exceeds 15 minutes', () => {
    const events = [
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:00Z` }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:05:00Z` }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:25:00Z` }),
    ];
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.flowBlocks).toHaveLength(2);
    expect(report.flowBlocks[0].eventCount).toBe(2);
    expect(report.flowBlocks[1].eventCount).toBe(1);
  });

  it('labels Deep Flow for long sessions with many events', () => {
    const events: UsageEvent[] = [];
    for (let i = 0; i < 6; i++) {
      const hour = 10;
      const minute = i * 10;
      events.push(makeEvent({
        timestamp: `${TARGET_DATE}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
      }));
    }
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.flowBlocks).toHaveLength(1);
    expect(report.flowBlocks[0].label).toBe('Deep Flow');
  });

  it('labels Moderate Session for mid-range blocks', () => {
    const events = [
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:00Z` }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:05:00Z` }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:12:00Z` }),
    ];
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.flowBlocks).toHaveLength(1);
    expect(report.flowBlocks[0].label).toBe('Moderate Session');
  });

  it('counts model switches correctly', () => {
    const events = [
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:00Z`, model: 'claude-opus-4' }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:02:00Z`, model: 'claude-sonnet-4' }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:04:00Z`, model: 'claude-opus-4' }),
    ];
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.flowBlocks[0].modelSwitches).toBe(2);
  });

  it('computes cache hit rate trend per event', () => {
    const events = [
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:00Z`, inputTokens: 900, cacheReadTokens: 100 }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:02:00Z`, inputTokens: 500, cacheReadTokens: 500 }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:04:00Z`, inputTokens: 0, cacheReadTokens: 0 }),
    ];
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    const trend = report.flowBlocks[0].cacheHitRateTrend;
    expect(trend).toHaveLength(3);
    expect(trend[0]).toBeCloseTo(0.1);
    expect(trend[1]).toBeCloseTo(0.5);
    expect(trend[2]).toBe(0);
  });

  it('buckets token velocity by minute', () => {
    const events = [
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:30Z`, totalTokens: 1000 }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:45Z`, totalTokens: 2000 }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:01:15Z`, totalTokens: 500 }),
    ];
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.tokenVelocity).toHaveLength(2);
    expect(report.tokenVelocity[0].tokensPerMinute).toBe(3000);
    expect(report.tokenVelocity[1].tokensPerMinute).toBe(500);
  });

  it('computes day summary with flow and think time', () => {
    const events = [
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:00Z`, sessionId: 's1' }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:05:00Z`, sessionId: 's1' }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:25:00Z`, sessionId: 's2' }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:30:00Z`, sessionId: 's2' }),
    ];
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.summary.totalSessions).toBe(2);
    expect(report.summary.totalEvents).toBe(4);
    expect(report.summary.flowTimeMs).toBe(10 * 60 * 1000);
    expect(report.summary.thinkTimeMs).toBe(20 * 60 * 1000);
    expect(report.summary.peakMinute).not.toBeNull();
  });

  it('excludes events from other dates', () => {
    const events = [
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:00Z` }),
      makeEvent({ timestamp: '2026-03-11T10:00:00Z' }),
      makeEvent({ timestamp: '2026-03-09T10:00:00Z' }),
    ];
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.events).toHaveLength(1);
    expect(report.flowBlocks).toHaveLength(1);
  });

  it('finds the correct dominant model per block', () => {
    const events = [
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:00Z`, model: 'claude-sonnet-4', totalTokens: 500 }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:02:00Z`, model: 'claude-opus-4', totalTokens: 3000 }),
      makeEvent({ timestamp: `${TARGET_DATE}T10:04:00Z`, model: 'claude-sonnet-4', totalTokens: 800 }),
    ];
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.flowBlocks[0].dominantModel).toBe('claude-opus-4');
  });

  it('handles single-event session with zero duration', () => {
    const event = makeEvent({ timestamp: `${TARGET_DATE}T14:30:00Z`, sessionId: 'solo' });
    const report = buildReplayReport([makeProvider([event])], TARGET_DATE);

    expect(report.flowBlocks[0].durationMs).toBe(0);
    expect(report.flowBlocks[0].modelSwitches).toBe(0);
    expect(report.summary.flowTimeMs).toBe(0);
    expect(report.summary.thinkTimeMs).toBe(0);
    expect(report.summary.flowThinkRatio).toBe(0);
  });

  it('handles events at month boundary correctly', () => {
    const monthEnd = '2026-03-31';
    const events = [
      makeEvent({ timestamp: `${monthEnd}T23:50:00Z`, date: monthEnd }),
      makeEvent({ timestamp: `${monthEnd}T23:55:00Z`, date: monthEnd }),
    ];
    const report = buildReplayReport([makeProvider(events)], monthEnd);

    expect(report.events).toHaveLength(2);
    expect(report.flowBlocks).toHaveLength(1);
    expect(report.date).toBe(monthEnd);
  });

  it('handles many events without error', () => {
    const events: UsageEvent[] = [];
    for (let i = 0; i < 120; i++) {
      const hour = Math.floor(i / 12) + 8;
      const minute = (i % 12) * 5;
      events.push(makeEvent({
        timestamp: `${TARGET_DATE}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
        sessionId: `s${Math.floor(i / 10)}`,
      }));
    }
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.events).toHaveLength(120);
    expect(report.flowBlocks.length).toBeGreaterThan(0);
    expect(report.summary.totalEvents).toBe(120);
    expect(report.summary.totalSessions).toBe(12);
  });

  it('sorts events chronologically regardless of input order', () => {
    const events = [
      makeEvent({ timestamp: `${TARGET_DATE}T15:00:00Z` }),
      makeEvent({ timestamp: `${TARGET_DATE}T09:00:00Z` }),
      makeEvent({ timestamp: `${TARGET_DATE}T12:00:00Z` }),
    ];
    const report = buildReplayReport([makeProvider(events)], TARGET_DATE);

    expect(report.events[0].timestamp).toBe(`${TARGET_DATE}T09:00:00Z`);
    expect(report.events[1].timestamp).toBe(`${TARGET_DATE}T12:00:00Z`);
    expect(report.events[2].timestamp).toBe(`${TARGET_DATE}T15:00:00Z`);
  });

  it('merges events from multiple providers', () => {
    const provider1 = makeProvider([
      makeEvent({ timestamp: `${TARGET_DATE}T10:00:00Z`, provider: 'claude-code', sessionId: 's1' }),
    ]);
    provider1.provider = 'claude-code';

    const provider2 = makeProvider([
      makeEvent({ timestamp: `${TARGET_DATE}T11:00:00Z`, provider: 'codex', sessionId: 's2' }),
    ]);
    provider2.provider = 'codex';

    const report = buildReplayReport([provider1, provider2], TARGET_DATE);

    expect(report.events).toHaveLength(2);
    expect(report.summary.totalSessions).toBe(2);
  });
});
