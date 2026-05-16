import { describe, expect, test } from 'bun:test';
import type {
  FlowBlock,
  ProviderColors,
  ProviderData,
  ReplayReport,
  UsageEvent,
} from '@tokenleak/core';
import { createInitialState } from './state';
import {
  buildReplayLiveDataProvider,
  moveReplayOverviewSelection,
  resetReplayDataInteraction,
  resetReplayPanelInteraction,
} from './replay-interaction';

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

function block(blockIndex: number, start: string, end: string): FlowBlock {
  const events = [event(start)];
  return {
    blockIndex,
    label: 'Quick Lookup',
    start,
    end,
    durationMs: Date.parse(end) - Date.parse(start),
    eventCount: events.length,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 20,
    cacheWriteTokens: 5,
    totalTokens: 175,
    cost: 0.01,
    dominantModel: 'gpt-5.4',
    events,
    modelSwitches: 0,
    cacheHitRateTrend: [0.2],
  };
}

describe('replay interaction resets', () => {
  test('panel reset clears TUI-only state while preserving the browser server', () => {
    const state = createInitialState();
    state.replayScrollOffset = 4;
    state.replaySelectedBlockIndex = 3;
    state.replayExpandedBlockIndex = 2;
    state.replayCursorEventIndex = 1;
    state.replayPlaybackActive = true;
    state.replayLiveServerPort = 3567;
    let stoppedPlayback = 0;

    resetReplayPanelInteraction(state, () => {
      stoppedPlayback++;
    });

    expect(state.replayScrollOffset).toBe(0);
    expect(state.replaySelectedBlockIndex).toBe(0);
    expect(state.replayExpandedBlockIndex).toBeNull();
    expect(state.replayCursorEventIndex).toBeNull();
    expect(state.replayPlaybackActive).toBe(false);
    expect(state.replayLiveServerPort).toBe(3567);
    expect(stoppedPlayback).toBe(1);
  });

  test('data reset also stops the browser server and clears its port', () => {
    const state = createInitialState();
    state.replayLiveServerPort = 3567;
    let stoppedServer = 0;

    resetReplayDataInteraction(
      state,
      () => {},
      () => {
        stoppedServer++;
      },
    );

    expect(stoppedServer).toBe(1);
    expect(state.replayLiveServerPort).toBeNull();
  });
});

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
  });

  test('returns an empty initial report for empty scoped data', () => {
    const liveData = buildReplayLiveDataProvider([], null, '2026-03-12');

    expect(liveData.initialDate).toBe('2026-03-12');
    expect(liveData.heatmap).toEqual([]);
    expect(liveData.initialReport.date).toBe('2026-03-12');
    expect(liveData.initialReport.events).toEqual([]);
  });
});

describe('moveReplayOverviewSelection', () => {
  test('does not desync selected block while playback cursor mode is active', () => {
    const state = createInitialState();
    state.cachedReplayReport = {
      date: '2026-03-10',
      events: [],
      flowBlocks: [
        block(0, '2026-03-10T09:00:00.000Z', '2026-03-10T09:00:00.000Z'),
        block(1, '2026-03-10T10:00:00.000Z', '2026-03-10T10:00:00.000Z'),
      ],
      tokenVelocity: [],
      summary: {
        totalSessions: 0,
        totalEvents: 0,
        flowTimeMs: 0,
        thinkTimeMs: 0,
        flowThinkRatio: 0,
        peakMinute: null,
      },
    };
    state.replaySelectedBlockIndex = 1;
    state.replayScrollOffset = 1;
    state.replayCursorEventIndex = 0;

    moveReplayOverviewSelection(state, -1, 3);

    expect(state.replaySelectedBlockIndex).toBe(1);
    expect(state.replayScrollOffset).toBe(1);
  });

  test('uses the caller-provided visible count when keeping selection visible', () => {
    const state = createInitialState();
    state.cachedReplayReport = {
      date: '2026-03-10',
      events: [],
      flowBlocks: Array.from({ length: 6 }, (_, index) =>
        block(index, `2026-03-10T1${index}:00:00.000Z`, `2026-03-10T1${index}:00:00.000Z`),
      ),
      tokenVelocity: [],
      summary: {
        totalSessions: 0,
        totalEvents: 0,
        flowTimeMs: 0,
        thinkTimeMs: 0,
        flowThinkRatio: 0,
        peakMinute: null,
      },
    };
    state.replaySelectedBlockIndex = 3;
    state.replayScrollOffset = 0;

    moveReplayOverviewSelection(state, 1, 3);

    expect(state.replaySelectedBlockIndex).toBe(4);
    expect(state.replayScrollOffset).toBe(2);
  });
});
