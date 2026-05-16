import type { ReplayReport, UsageEvent } from '@tokenleak/core';
import type { AppState, ReplayPlaybackSpeed } from './state.js';

export const REPLAY_PLAYBACK_SPEEDS: readonly ReplayPlaybackSpeed[] = [60, 240, 600];
export const REPLAY_PLAYBACK_TICK_MS = 100;

/** Per-tick event advance count derived from the configured speed. */
export function eventsPerTick(speed: ReplayPlaybackSpeed): number {
  return Math.max(1, Math.round(speed / 60));
}

/** Enter step/playback mode by parking the cursor on the first event. */
export function enterReplayPlayback(state: AppState): void {
  const events = state.cachedReplayReport?.events;
  if (!events || events.length === 0) return;
  selectReplayCursorEvent(state, 0);
  state.replayPlaybackActive = false;
}

/** Exit playback mode entirely. Caller is responsible for clearing any timer. */
export function exitReplayPlayback(state: AppState): void {
  state.replayCursorEventIndex = null;
  state.replayPlaybackActive = false;
}

/**
 * Move the cursor by `delta` events. Negative values step backwards.
 * Clamps at the day's bounds. No-op when not in playback mode.
 */
export function stepReplayCursor(state: AppState, delta: number): void {
  const report = state.cachedReplayReport;
  if (!report || state.replayCursorEventIndex === null || report.events.length === 0) return;
  const next = clamp(state.replayCursorEventIndex + delta, 0, report.events.length - 1);
  selectReplayCursorEvent(state, next);
}

/**
 * Jump to the start of the next/previous flow block boundary. If currently
 * inside a block, "previous" lands on this block's first event; "next" jumps
 * to the next block's first event.
 */
export function jumpReplayCursorToBlockBoundary(state: AppState, dir: 1 | -1): void {
  const report = state.cachedReplayReport;
  if (!report || state.replayCursorEventIndex === null) return;
  if (report.flowBlocks.length === 0 || report.events.length === 0) return;
  const currentBlock = blockIndexForEvent(report, state.replayCursorEventIndex);
  const currentEventTs = Date.parse(report.events[state.replayCursorEventIndex].timestamp);

  if (dir === 1) {
    // Find the next block whose first event is strictly after the current one.
    for (let i = currentBlock + 1; i < report.flowBlocks.length; i++) {
      const startTs = Date.parse(report.flowBlocks[i].start);
      if (startTs > currentEventTs) {
        const idx = firstEventIndexOnOrAfter(report.events, startTs);
        if (idx !== null) {
          selectReplayCursorEvent(state, idx);
          return;
        }
      }
    }
    // No next block — jump to last event.
    selectReplayCursorEvent(state, report.events.length - 1);
    return;
  }

  // dir === -1: snap to the start of the current block. If already on it, jump to previous block.
  const currentBlockStartTs = Date.parse(report.flowBlocks[currentBlock].start);
  if (currentEventTs > currentBlockStartTs) {
    const idx = firstEventIndexOnOrAfter(report.events, currentBlockStartTs);
    if (idx !== null) {
      selectReplayCursorEvent(state, idx);
      return;
    }
  }
  for (let i = currentBlock - 1; i >= 0; i--) {
    const startTs = Date.parse(report.flowBlocks[i].start);
    const idx = firstEventIndexOnOrAfter(report.events, startTs);
    if (idx !== null) {
      selectReplayCursorEvent(state, idx);
      return;
    }
  }
  selectReplayCursorEvent(state, 0);
}

/**
 * Jump to the next/previous "interesting" moment.
 * Interesting = peak velocity minute, model switches, flow block starts,
 * and individual events whose cost exceeds 2× the day's mean event cost.
 * Cycles forward (dir = 1) or backward (dir = -1).
 */
export function jumpReplayCursorToInteresting(state: AppState, dir: 1 | -1): void {
  const report = state.cachedReplayReport;
  if (!report || state.replayCursorEventIndex === null || report.events.length === 0) return;
  const points = computeInterestingEventIndices(report);
  if (points.length === 0) return;
  const cursor = state.replayCursorEventIndex;
  let target: number | null = null;
  if (dir === 1) {
    for (const idx of points) {
      if (idx > cursor) {
        target = idx;
        break;
      }
    }
    if (target === null) target = points[0]; // wrap
  } else {
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i] < cursor) {
        target = points[i];
        break;
      }
    }
    if (target === null) target = points[points.length - 1]; // wrap
  }
  selectReplayCursorEvent(state, target);
}

/** Toggle the play loop. Returns the new active state. */
export function toggleReplayPlayback(state: AppState): boolean {
  if (state.replayCursorEventIndex === null) return false;
  state.replayPlaybackActive = !state.replayPlaybackActive;
  return state.replayPlaybackActive;
}

/** Advance the cursor by one tick's worth of events. Returns false when at end-of-day. */
export function tickReplayPlayback(state: AppState): boolean {
  const report = state.cachedReplayReport;
  if (!report || state.replayCursorEventIndex === null || !state.replayPlaybackActive) {
    return false;
  }
  const advance = eventsPerTick(state.replayPlaybackSpeed);
  const next = clamp(state.replayCursorEventIndex + advance, 0, report.events.length - 1);
  selectReplayCursorEvent(state, next);
  if (next >= report.events.length - 1) {
    state.replayPlaybackActive = false;
    return false;
  }
  return true;
}

export function setReplayPlaybackSpeed(state: AppState, speed: ReplayPlaybackSpeed): void {
  state.replayPlaybackSpeed = speed;
}

/** Cumulative aggregate up to (and including) the cursor's event. */
export interface PlaybackSummary {
  cursorIndex: number;
  cursorEvent: UsageEvent;
  cumulativeCost: number;
  cumulativeTokens: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  cumulativeCacheReadTokens: number;
  cumulativeCacheWriteTokens: number;
  cacheHitRate: number;
  modelMix: Map<string, number>;
}

export function computePlaybackSummary(report: ReplayReport, cursorIndex: number): PlaybackSummary | null {
  if (report.events.length === 0) return null;
  const idx = clamp(cursorIndex, 0, report.events.length - 1);
  const cursorEvent = report.events[idx];
  let cost = 0;
  let tokens = 0;
  let inputT = 0;
  let outputT = 0;
  let cacheR = 0;
  let cacheW = 0;
  const mix = new Map<string, number>();
  for (let i = 0; i <= idx; i++) {
    const e = report.events[i];
    cost += e.cost;
    tokens += e.totalTokens;
    inputT += e.inputTokens;
    outputT += e.outputTokens;
    cacheR += e.cacheReadTokens;
    cacheW += e.cacheWriteTokens;
    mix.set(e.model, (mix.get(e.model) ?? 0) + e.totalTokens);
  }
  const denom = inputT + cacheR;
  return {
    cursorIndex: idx,
    cursorEvent,
    cumulativeCost: cost,
    cumulativeTokens: tokens,
    cumulativeInputTokens: inputT,
    cumulativeOutputTokens: outputT,
    cumulativeCacheReadTokens: cacheR,
    cumulativeCacheWriteTokens: cacheW,
    cacheHitRate: denom > 0 ? cacheR / denom : 0,
    modelMix: mix,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function selectReplayCursorEvent(state: AppState, eventIndex: number): void {
  const report = state.cachedReplayReport;
  if (!report || report.events.length === 0) return;
  const next = clamp(eventIndex, 0, report.events.length - 1);
  state.replayCursorEventIndex = next;
  state.replaySelectedBlockIndex = blockIndexForEvent(report, next);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function blockIndexForEvent(report: ReplayReport, eventIdx: number): number {
  const events = report.events;
  if (eventIdx < 0 || eventIdx >= events.length) return 0;
  const ts = Date.parse(events[eventIdx].timestamp);
  for (let i = 0; i < report.flowBlocks.length; i++) {
    const b = report.flowBlocks[i];
    if (ts >= Date.parse(b.start) && ts <= Date.parse(b.end)) return i;
  }
  // Fall back to the most recent block whose start is ≤ this event.
  let best = 0;
  for (let i = 0; i < report.flowBlocks.length; i++) {
    if (Date.parse(report.flowBlocks[i].start) <= ts) best = i;
  }
  return best;
}

function firstEventIndexOnOrAfter(events: UsageEvent[], ts: number): number | null {
  for (let i = 0; i < events.length; i++) {
    if (Date.parse(events[i].timestamp) >= ts) return i;
  }
  return null;
}

/**
 * Compute "interesting" event indices in chronological order.
 * Each kind of moment is added once; the merged set is deduped + sorted.
 */
export function computeInterestingEventIndices(report: ReplayReport): number[] {
  if (report.events.length === 0) return [];
  const set = new Set<number>();

  // 1. Flow block starts
  for (const b of report.flowBlocks) {
    const startTs = Date.parse(b.start);
    const idx = firstEventIndexOnOrAfter(report.events, startTs);
    if (idx !== null) set.add(idx);
  }

  // 2. Peak minute (the one with the highest tokensPerMinute) — find first event in that minute
  if (report.summary.peakMinute) {
    const peakStart = Date.parse(report.summary.peakMinute.minute);
    const peakEnd = peakStart + 60_000;
    for (let i = 0; i < report.events.length; i++) {
      const ts = Date.parse(report.events[i].timestamp);
      if (ts >= peakStart && ts < peakEnd) {
        set.add(i);
        break;
      }
    }
  }

  // 3. Model switches: the event at which the model differs from the previous event
  for (let i = 1; i < report.events.length; i++) {
    if (report.events[i].model !== report.events[i - 1].model) set.add(i);
  }

  // 4. Outlier events: cost > 2× the day's mean event cost
  const totalCost = report.events.reduce((s, e) => s + e.cost, 0);
  const meanCost = totalCost / report.events.length;
  const threshold = meanCost * 2;
  for (let i = 0; i < report.events.length; i++) {
    if (report.events[i].cost > threshold) set.add(i);
  }

  return Array.from(set).sort((a, b) => a - b);
}
