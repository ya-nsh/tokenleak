import { describe, expect, test } from 'bun:test';
import type { ProviderColors, ProviderData, ReplayReport, UsageEvent } from '@tokenleak/core';
import {
  buildReplayHeatmap,
  buildReplayLiveDataProvider,
  makeEmptyReplayReport,
} from '../replay-data';

const COLORS: ProviderColors = {
  primary: '#111111',
  secondary: '#222222',
  gradient: ['#111111', '#222222'],
};

function event(timestamp: string, overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    provider: 'codex',
    timestamp,
    date: timestamp.slice(0, 10),
    model: 'gpt-5.4',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 20,
    cacheWriteTokens: 5,
    totalTokens: 175,
    cost: 0.01,
    ...overrides,
  };
}

function provider(events: UsageEvent[]): ProviderData {
  return {
    provider: 'codex',
    displayName: 'Codex',
    colors: COLORS,
    daily: [],
    totalTokens: events.reduce((sum, e) => sum + e.totalTokens, 0),
    totalCost: events.reduce((sum, e) => sum + e.cost, 0),
    events,
  };
}

describe('buildReplayLiveDataProvider', () => {
  test('builds heatmap navigation and defaults to the latest active day', () => {
    const events = [
      event('2026-03-10T09:00:00.000Z', { totalTokens: 100, cost: 0.01 }),
      event('2026-03-10T10:00:00.000Z', { totalTokens: 200, cost: 0.02 }),
      event('2026-03-11T11:00:00.000Z', { totalTokens: 300, cost: 0.03 }),
    ];

    const liveData = buildReplayLiveDataProvider([provider(events)], null, '2026-03-12');

    expect(liveData.initialDate).toBe('2026-03-11');
    expect(liveData.initialReport.date).toBe('2026-03-11');
    expect(liveData.initialReport.events).toHaveLength(1);
    expect(liveData.heatmap).toEqual([
      { date: '2026-03-10', tokens: 300, cost: 0.03, events: 2 },
      { date: '2026-03-11', tokens: 300, cost: 0.03, events: 1 },
    ]);
    const march10Report = liveData.getReport('2026-03-10') as ReplayReport;
    expect(march10Report.events).toHaveLength(2);
    expect(liveData.getReport('2026-03-12')).toBeNull();
  });

  test('returns an empty initial report for empty scoped data', () => {
    const liveData = buildReplayLiveDataProvider([], null, '2026-03-12');

    expect(liveData.initialDate).toBe('2026-03-12');
    expect(liveData.heatmap).toEqual([]);
    expect(liveData.initialReport.date).toBe('2026-03-12');
    expect(liveData.initialReport.events).toEqual([]);
  });
});

describe('buildReplayLiveDataProvider date selection', () => {
  test('an explicit replay date wins over the latest active day', () => {
    const events = [event('2026-03-10T09:00:00.000Z'), event('2026-03-11T11:00:00.000Z')];
    const liveData = buildReplayLiveDataProvider([provider(events)], '2026-03-10', '2026-03-12');
    expect(liveData.initialDate).toBe('2026-03-10');
    expect(liveData.initialReport.events).toHaveLength(1);
  });
});

describe('buildReplayHeatmap', () => {
  test('sums events across providers per day, oldest first', () => {
    const heatmap = buildReplayHeatmap([
      provider([event('2026-03-11T09:00:00.000Z')]),
      provider([event('2026-03-10T09:00:00.000Z'), event('2026-03-11T10:00:00.000Z')]),
    ]);
    expect(heatmap.map((entry) => [entry.date, entry.events])).toEqual([
      ['2026-03-10', 1],
      ['2026-03-11', 2],
    ]);
  });

  test('ignores providers without event data', () => {
    expect(buildReplayHeatmap([{ ...provider([]), events: undefined }])).toEqual([]);
  });
});

describe('makeEmptyReplayReport', () => {
  test('is a zeroed report for the date', () => {
    const report: ReplayReport = makeEmptyReplayReport('2026-03-12');
    expect(report.date).toBe('2026-03-12');
    expect(report.events).toEqual([]);
    expect(report.summary.totalEvents).toBe(0);
    expect(report.summary.peakMinute).toBeNull();
  });
});
