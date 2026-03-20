import type { AdvisorReport, FocusReport, ExplainReport, CompareOutput, MoreStats } from '@tokenleak/core';
import type { TuiData } from './data.js';

export type ViewMode = 'overview' | 'matrix' | 'advisor' | 'focus' | 'explain' | 'compare' | 'export' | 'wrapped';
export type SortMode = 'cost' | 'tokens';

export interface AppState {
  selectedWindowIndex: number; // 0=1D, 1=7D, 2=30D, 3=90D, 4=ALL
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

  // matrix pages
  matrixPage: number;               // 0-3

  // help overlay
  showHelp: boolean;

  // wrapped view
  wrappedScrollOffset: number;

  // export view state
  exportStatus: string | null;      // status message shown during export

  // lazy caches (null = not yet computed, cleared on refresh)
  cachedAdvisorReport: AdvisorReport | null;
  cachedFocusReport: FocusReport | null;
  cachedExplainReport: ExplainReport | null;
  cachedCompareOutput: CompareOutput | null;
  cachedMoreStats: MoreStats | null;
}

export const WINDOW_LABELS = ['1D', '7D', '30D', '90D', 'ALL'] as const;
export const WINDOW_DAYS = [1, 7, 30, 90, 0] as const;

export function createInitialState(): AppState {
  return {
    selectedWindowIndex: 4,       // ALL
    selectedView: 'overview',
    isLoading: true,
    data: null,
    sortMode: 'cost',
    modelScrollOffset: 0,
    explainDate: null,
    focusScrollOffset: 0,
    advisorScrollOffset: 0,
    compareScrollOffset: 0,
    matrixPage: 0,
    showHelp: false,
    wrappedScrollOffset: 0,
    exportStatus: null,
    cachedAdvisorReport: null,
    cachedFocusReport: null,
    cachedExplainReport: null,
    cachedCompareOutput: null,
    cachedMoreStats: null,
  };
}
