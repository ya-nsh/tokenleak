import type { AdvisorReport, FocusReport, ExplainReport, CompareOutput } from '@tokenleak/core';
import type { TuiData } from './data.js';

export type ViewMode = 'overview' | 'matrix' | 'advisor' | 'focus' | 'explain' | 'compare' | 'export';
export type SortMode = 'cost' | 'tokens';

export interface AppState {
  selectedWindowIndex: number; // 0=7D, 1=30D, 2=90D, 3=ALL
  selectedView: ViewMode;
  isLoading: boolean;
  data: TuiData | null;
  sortMode: SortMode;
  modelScrollOffset: number;

  // new view state
  explainDate: string | null;       // YYYY-MM-DD, defaults to peak day
  focusScrollOffset: number;
  advisorScrollOffset: number;
  compareScrollOffset: number;

  // export view state
  exportStatus: string | null;      // status message shown during export

  // lazy caches (null = not yet computed, cleared on refresh)
  cachedAdvisorReport: AdvisorReport | null;
  cachedFocusReport: FocusReport | null;
  cachedExplainReport: ExplainReport | null;
  cachedCompareOutput: CompareOutput | null;
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
    explainDate: null,
    focusScrollOffset: 0,
    advisorScrollOffset: 0,
    compareScrollOffset: 0,
    exportStatus: null,
    cachedAdvisorReport: null,
    cachedFocusReport: null,
    cachedExplainReport: null,
    cachedCompareOutput: null,
  };
}
