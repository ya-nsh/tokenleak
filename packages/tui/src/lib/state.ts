import type { TuiData } from './data.js';

export type ViewMode = 'overview' | 'bloomberg';
export type SortMode = 'cost' | 'tokens';

export interface AppState {
  selectedWindowIndex: number; // 0=7D, 1=30D, 2=90D, 3=ALL
  selectedView: ViewMode;
  isLoading: boolean;
  data: TuiData | null;
  sortMode: SortMode;
  modelScrollOffset: number;
}

export const WINDOW_LABELS = ['7D', '30D', '90D', 'ALL'] as const;
export const WINDOW_DAYS = [7, 30, 90, 0] as const;

export function createInitialState(): AppState {
  return {
    selectedWindowIndex: 3,
    selectedView: 'overview',
    isLoading: true,
    data: null,
    sortMode: 'cost',
    modelScrollOffset: 0,
  };
}
