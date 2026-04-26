import { describe, expect, test } from 'bun:test';
import { createInitialState, DEFAULT_WINDOW_INDEX, WINDOW_LABELS } from './state';

describe('createInitialState', () => {
  test('opens on the 7D window by default', () => {
    const state = createInitialState();

    expect(state.selectedWindowIndex).toBe(DEFAULT_WINDOW_INDEX);
    expect(WINDOW_LABELS[state.selectedWindowIndex]).toBe('7D');
  });

  test('starts with empty transient view task state', () => {
    const state = createInitialState();

    expect(state.viewTasks.pendingKeys.size).toBe(0);
    expect(state.viewTasks.errors).toEqual({});
    expect(state.viewTasks.activeLabel).toBeNull();
  });
});
