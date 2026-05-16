import { describe, expect, it } from 'bun:test';
import type { ReplayReport, UsageEvent, FlowBlock } from '@tokenleak/core';
import { createInitialState } from './state';
import type { AppState } from './state';
import {
  computeInterestingEventIndices,
  computePlaybackSummary,
  enterReplayPlayback,
  eventsPerTick,
  exitReplayPlayback,
  jumpReplayCursorToBlockBoundary,
  jumpReplayCursorToInteresting,
  setReplayPlaybackSpeed,
  stepReplayCursor,
  tickReplayPlayback,
  toggleReplayPlayback,
  selectReplayCursorEvent,
} from './replay-playback';

function ev(timestamp: string, model: string, totalTokens: number, cost: number): UsageEvent {
  return {
    provider: 'codex',
    timestamp,
    date: timestamp.slice(0, 10),
    model,
    inputTokens: Math.round(totalTokens * 0.7),
    outputTokens: Math.round(totalTokens * 0.2),
    cacheReadTokens: Math.round(totalTokens * 0.08),
    cacheWriteTokens: Math.round(totalTokens * 0.02),
    totalTokens,
    cost,
  };
}

function block(
  blockIndex: number,
  start: string,
  end: string,
  events: UsageEvent[],
  label: FlowBlock['label'] = 'Deep Flow',
): FlowBlock {
  const totalTokens = events.reduce((s, e) => s + e.totalTokens, 0);
  const cost = events.reduce((s, e) => s + e.cost, 0);
  return {
    blockIndex,
    label,
    start,
    end,
    durationMs: Date.parse(end) - Date.parse(start),
    eventCount: events.length,
    inputTokens: events.reduce((s, e) => s + e.inputTokens, 0),
    outputTokens: events.reduce((s, e) => s + e.outputTokens, 0),
    cacheReadTokens: events.reduce((s, e) => s + e.cacheReadTokens, 0),
    cacheWriteTokens: events.reduce((s, e) => s + e.cacheWriteTokens, 0),
    totalTokens,
    cost,
    dominantModel: events[0]?.model ?? 'unknown',
    events,
    modelSwitches: 0,
    cacheHitRateTrend: [0.4, 0.7],
  };
}

function makeReport(): ReplayReport {
  const events: UsageEvent[] = [
    ev('2026-04-22T09:30:00.000', 'claude-sonnet-4', 1_000, 0.01),
    ev('2026-04-22T09:32:00.000', 'claude-sonnet-4', 2_000, 0.02),
    ev('2026-04-22T09:35:00.000', 'gpt-5.4', 4_000, 0.04),
    ev('2026-04-22T11:00:00.000', 'claude-haiku-4', 500, 0.005),
    ev('2026-04-22T11:01:00.000', 'claude-haiku-4', 600, 0.005),
    ev('2026-04-22T14:00:00.000', 'claude-opus-4-7', 100_000, 5.00),
  ];
  return {
    date: '2026-04-22',
    events,
    flowBlocks: [
      block(0, '2026-04-22T09:30:00.000', '2026-04-22T09:35:00.000', events.slice(0, 3), 'Deep Flow'),
      block(1, '2026-04-22T11:00:00.000', '2026-04-22T11:01:00.000', events.slice(3, 5), 'Quick Lookup'),
      block(2, '2026-04-22T14:00:00.000', '2026-04-22T14:00:00.000', events.slice(5, 6), 'Moderate Session'),
    ],
    tokenVelocity: [
      { minute: '2026-04-22T09:30:00.000', tokensPerMinute: 1_000 },
      { minute: '2026-04-22T14:00:00.000', tokensPerMinute: 100_000 },
    ],
    summary: {
      totalSessions: 3,
      totalEvents: 6,
      flowTimeMs: 360_000,
      thinkTimeMs: 16_140_000,
      flowThinkRatio: 0.022,
      peakMinute: { minute: '2026-04-22T14:00:00.000', tokensPerMinute: 100_000 },
    },
  };
}

function withReport(): AppState {
  const state = createInitialState();
  state.cachedReplayReport = makeReport();
  state.replayDate = state.cachedReplayReport.date;
  return state;
}

describe('eventsPerTick', () => {
  it('returns 1 / 4 / 10 for 60 / 240 / 600 speeds', () => {
    expect(eventsPerTick(60)).toBe(1);
    expect(eventsPerTick(240)).toBe(4);
    expect(eventsPerTick(600)).toBe(10);
  });
});

describe('enterReplayPlayback / exitReplayPlayback', () => {
  it('parks the cursor on event 0 and selects its block', () => {
    const state = withReport();
    enterReplayPlayback(state);
    expect(state.replayCursorEventIndex).toBe(0);
    expect(state.replayPlaybackActive).toBe(false);
    expect(state.replaySelectedBlockIndex).toBe(0);
  });

  it('is a no-op when there are no events', () => {
    const state = withReport();
    state.cachedReplayReport!.events = [];
    enterReplayPlayback(state);
    expect(state.replayCursorEventIndex).toBeNull();
  });

  it('exit clears playback state', () => {
    const state = withReport();
    enterReplayPlayback(state);
    state.replayPlaybackActive = true;
    exitReplayPlayback(state);
    expect(state.replayCursorEventIndex).toBeNull();
    expect(state.replayPlaybackActive).toBe(false);
  });
});

describe('stepReplayCursor', () => {
  it('selectReplayCursorEvent clamps and keeps the selected block synced', () => {
    const state = withReport();

    selectReplayCursorEvent(state, 100);

    expect(state.replayCursorEventIndex).toBe(5);
    expect(state.replaySelectedBlockIndex).toBe(2);

    selectReplayCursorEvent(state, -10);

    expect(state.replayCursorEventIndex).toBe(0);
    expect(state.replaySelectedBlockIndex).toBe(0);
  });

  it('moves forward and back', () => {
    const state = withReport();
    enterReplayPlayback(state);
    stepReplayCursor(state, 2);
    expect(state.replayCursorEventIndex).toBe(2);
    stepReplayCursor(state, -1);
    expect(state.replayCursorEventIndex).toBe(1);
  });

  it('clamps at boundaries', () => {
    const state = withReport();
    enterReplayPlayback(state);
    stepReplayCursor(state, -10);
    expect(state.replayCursorEventIndex).toBe(0);
    stepReplayCursor(state, 100);
    expect(state.replayCursorEventIndex).toBe(state.cachedReplayReport!.events.length - 1);
  });

  it('updates the selected block to the one containing the cursor event', () => {
    const state = withReport();
    enterReplayPlayback(state);
    stepReplayCursor(state, 3); // event 3 is in block 1 (Quick Lookup)
    expect(state.replaySelectedBlockIndex).toBe(1);
    stepReplayCursor(state, 2); // event 5 is in block 2
    expect(state.replaySelectedBlockIndex).toBe(2);
  });

  it('is a no-op without an active cursor', () => {
    const state = withReport();
    stepReplayCursor(state, 1);
    expect(state.replayCursorEventIndex).toBeNull();
  });
});

describe('jumpReplayCursorToBlockBoundary', () => {
  it('forward: jumps to the start event of the next block', () => {
    const state = withReport();
    enterReplayPlayback(state);
    stepReplayCursor(state, 1); // mid-block 0
    jumpReplayCursorToBlockBoundary(state, 1);
    // First event of block 1 is event index 3
    expect(state.replayCursorEventIndex).toBe(3);
    expect(state.replaySelectedBlockIndex).toBe(1);
  });

  it('backward: snaps to the start event of the current block first, then previous', () => {
    const state = withReport();
    enterReplayPlayback(state);
    stepReplayCursor(state, 4); // mid-block 1, event index 4
    jumpReplayCursorToBlockBoundary(state, -1);
    // First event of block 1 is index 3
    expect(state.replayCursorEventIndex).toBe(3);
    // Pressing again should go back to block 0
    jumpReplayCursorToBlockBoundary(state, -1);
    expect(state.replayCursorEventIndex).toBe(0);
    expect(state.replaySelectedBlockIndex).toBe(0);
  });

  it('forward at the last block clamps to the last event', () => {
    const state = withReport();
    enterReplayPlayback(state);
    stepReplayCursor(state, 5); // last event
    jumpReplayCursorToBlockBoundary(state, 1);
    expect(state.replayCursorEventIndex).toBe(5);
  });
});

describe('jumpReplayCursorToInteresting', () => {
  it('walks through interesting moments forward and wraps at the end', () => {
    const state = withReport();
    enterReplayPlayback(state);
    const points = computeInterestingEventIndices(state.cachedReplayReport!);
    expect(points.length).toBeGreaterThan(0);

    // Cursor starts at 0; first call should land on the next interesting > 0.
    const firstInteresting = points.find((p) => p > 0)!;
    jumpReplayCursorToInteresting(state, 1);
    expect(state.replayCursorEventIndex).toBe(firstInteresting);

    // Walk all the way through; eventually wraps to points[0].
    for (let i = 0; i < points.length + 1; i++) {
      jumpReplayCursorToInteresting(state, 1);
    }
    // After this many forward steps we should have wrapped at least once.
    expect(points).toContain(state.replayCursorEventIndex!);
  });

  it('walks backwards', () => {
    const state = withReport();
    enterReplayPlayback(state);
    stepReplayCursor(state, 5);
    jumpReplayCursorToInteresting(state, -1);
    expect(state.replayCursorEventIndex).toBeLessThan(5);
  });
});

describe('toggleReplayPlayback / tickReplayPlayback / setReplayPlaybackSpeed', () => {
  it('toggle returns the new active state', () => {
    const state = withReport();
    enterReplayPlayback(state);
    expect(toggleReplayPlayback(state)).toBe(true);
    expect(state.replayPlaybackActive).toBe(true);
    expect(toggleReplayPlayback(state)).toBe(false);
  });

  it('toggle is a no-op outside playback', () => {
    const state = withReport();
    expect(toggleReplayPlayback(state)).toBe(false);
  });

  it('tick advances the cursor by speed-derived events', () => {
    const state = withReport();
    enterReplayPlayback(state);
    state.replayPlaybackActive = true;
    setReplayPlaybackSpeed(state, 240); // 4 events/tick
    tickReplayPlayback(state);
    expect(state.replayCursorEventIndex).toBe(4);
  });

  it('tick stops playback at the end of the day', () => {
    const state = withReport();
    enterReplayPlayback(state);
    state.replayPlaybackActive = true;
    setReplayPlaybackSpeed(state, 600); // 10 events/tick > total 6
    expect(tickReplayPlayback(state)).toBe(false);
    expect(state.replayPlaybackActive).toBe(false);
    expect(state.replayCursorEventIndex).toBe(state.cachedReplayReport!.events.length - 1);
  });

  it('tick is a no-op when playback is not active', () => {
    const state = withReport();
    enterReplayPlayback(state);
    state.replayPlaybackActive = false;
    expect(tickReplayPlayback(state)).toBe(false);
  });
});

describe('computePlaybackSummary', () => {
  it('returns null when there are no events', () => {
    const state = withReport();
    state.cachedReplayReport!.events = [];
    expect(computePlaybackSummary(state.cachedReplayReport!, 0)).toBeNull();
  });

  it('sums cumulative cost / tokens / mix up to and including the cursor', () => {
    const report = makeReport();
    const summary = computePlaybackSummary(report, 2);
    expect(summary).not.toBeNull();
    expect(summary!.cumulativeCost).toBeCloseTo(0.07, 5);
    expect(summary!.cumulativeTokens).toBe(7_000);
    expect(summary!.modelMix.get('claude-sonnet-4')).toBe(3_000);
    expect(summary!.modelMix.get('gpt-5.4')).toBe(4_000);
  });
});
