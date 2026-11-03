import type { AppState } from './state.js';
import { exitReplayPlayback } from './replay-playback.js';

type StopPlaybackTimer = () => void;
type StopLiveServer = (state: AppState) => void;

function clampItemIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(index, itemCount - 1));
}

function keepSelectedItemVisible(selectedIndex: number, scrollOffset: number, visibleCount: number): number {
  if (visibleCount <= 0) {
    return scrollOffset;
  }
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

