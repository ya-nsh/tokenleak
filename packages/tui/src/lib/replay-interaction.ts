import type { ProviderData } from '@tokenleak/core';
import { buildReplayReport, getTodayLocal } from '@tokenleak/core';
import type { ReplayHeatmapEntry, ReplayLiveDataProvider } from '@tokenleak/renderers';
import type { AppState } from './state.js';
import { exitReplayPlayback } from './replay-playback.js';

type StopPlaybackTimer = () => void;
type StopLiveServer = (state: AppState) => void;

function clampItemIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(index, itemCount - 1));
}

function keepSelectedItemVisible(selectedIndex: number, scrollOffset: number, visibleCount: number): number {
  if (selectedIndex < scrollOffset) {
    return selectedIndex;
  }
  if (selectedIndex >= scrollOffset + visibleCount) {
    return selectedIndex - visibleCount + 1;
  }
  return scrollOffset;
}

export function resetReplayPanelInteraction(
  state: AppState,
  stopPlaybackTimer: StopPlaybackTimer,
): void {
  state.replayScrollOffset = 0;
  state.replaySelectedBlockIndex = 0;
  state.replayExpandedBlockIndex = null;
  exitReplayPlayback(state);
  stopPlaybackTimer();
}

export function resetReplayDataInteraction(
  state: AppState,
  stopPlaybackTimer: StopPlaybackTimer,
  stopLiveServer: StopLiveServer,
): void {
  resetReplayPanelInteraction(state, stopPlaybackTimer);
  stopLiveServer(state);
  state.replayLiveServerPort = null;
}

export function moveReplayOverviewSelection(
  state: AppState,
  direction: number,
  visibleCount: number,
): void {
  if (state.replayCursorEventIndex !== null) return;
  const itemCount = state.cachedReplayReport?.flowBlocks.length ?? 0;
  if (itemCount <= 0) return;
  const selected = clampItemIndex(state.replaySelectedBlockIndex + direction, itemCount);
  state.replaySelectedBlockIndex = selected;
  state.replayScrollOffset = keepSelectedItemVisible(
    selected,
    state.replayScrollOffset,
    visibleCount,
  );
}

export function keepReplaySelectionVisible(state: AppState, visibleCount: number): void {
  const itemCount = state.cachedReplayReport?.flowBlocks.length ?? 0;
  if (itemCount <= 0) return;
  const selected = clampItemIndex(state.replaySelectedBlockIndex, itemCount);
  state.replaySelectedBlockIndex = selected;
  state.replayScrollOffset = keepSelectedItemVisible(
    selected,
    state.replayScrollOffset,
    visibleCount,
  );
}

export function buildReplayHeatmap(providers: ProviderData[]): ReplayHeatmapEntry[] {
  const byDate = new Map<string, { tokens: number; cost: number; events: number }>();
  for (const provider of providers) {
    const events = provider.events ?? [];
    for (const event of events) {
      const current = byDate.get(event.date) ?? { tokens: 0, cost: 0, events: 0 };
      current.tokens += event.totalTokens;
      current.cost += event.cost;
      current.events += 1;
      byDate.set(event.date, current);
    }
  }

  return Array.from(byDate.entries())
    .map(([date, values]) => ({
      date,
      tokens: values.tokens,
      cost: values.cost,
      events: values.events,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function latestActiveDate(heatmap: ReplayHeatmapEntry[]): string | null {
  let latest: string | null = null;
  for (const entry of heatmap) {
    if (entry.events > 0 && (latest === null || entry.date > latest)) {
      latest = entry.date;
    }
  }
  return latest;
}

export function buildReplayLiveDataProvider(
  providers: ProviderData[],
  replayDate: string | null,
  fallbackDate: string = getTodayLocal(),
): ReplayLiveDataProvider {
  const heatmap = buildReplayHeatmap(providers);
  const initialDate = replayDate ?? latestActiveDate(heatmap) ?? fallbackDate;
  return {
    heatmap,
    initialDate,
    initialReport: buildReplayReport(providers, initialDate),
    getReport: (date: string) => buildReplayReport(providers, date),
  };
}
