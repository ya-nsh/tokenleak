import type {
  AdvisorReport,
  FocusReport,
  ExplainReport,
  CompareOutput,
  MoreStats,
  ReplayReport,
  WasteReport,
  NutritionReport,
  Receipt,
  ReceiptCategory,
} from '@tokenleak/core';
import type { CursorSetupStatus } from '@tokenleak/registry';
import type { TuiData } from './data.js';

export type ViewMode =
  | 'overview'
  | 'matrix'
  | 'advisor'
  | 'focus'
  | 'explain'
  | 'compare'
  | 'export'
  | 'wrapped'
  | 'replay'
  | 'nutrition'
  | 'receipts';
export type SortMode = 'cost' | 'tokens';
export type ReceiptsSortMode = 'cost' | 'qty' | 'alpha';
export type CursorSetupField = 'label' | 'token';

export interface ViewTaskState {
  pendingKeys: Set<string>;
  errors: Record<string, string>;
  activeLabel: string | null;
}

export interface AppState {
  selectedWindowIndex: number; // 0=1D, 1=7D, 2=30D, 3=90D, 4=ALL
  selectedView: ViewMode;
  isLoading: boolean;
  data: TuiData | null;
  sortMode: SortMode;
  modelScrollOffset: number;

  // new view state
  explainDate: string | null; // YYYY-MM-DD, defaults to peak day
  focusScrollOffset: number;
  advisorScrollOffset: number;
  nutritionScrollOffset: number;
  nutritionSignalsLoading: boolean;
  nutritionSignalsLoadedKeys: Set<string>;
  compareScrollOffset: number;
  viewTasks: ViewTaskState;

  // matrix pages
  matrixPage: number; // 0-3

  // help overlay
  showHelp: boolean;

  // wrapped view
  wrappedScrollOffset: number;

  // export view state
  exportStatus: string | null; // status message shown during export

  // cursor setup modal state
  showCursorSetup: boolean;
  cursorSetupField: CursorSetupField;
  cursorSetupLabel: string;
  cursorSetupToken: string;
  cursorSetupMessage: string | null;
  cursorSetupSubmitting: boolean;
  cursorSetupStatusOverride: CursorSetupStatus | null;

  // replay view state
  replayDate: string | null;
  replayScrollOffset: number;
  replayExpandedBlocks: Set<number>;

  // receipts view state
  receiptsScrollOffset: number;
  receiptsExpandedLineIndex: number | null;
  receiptsSortMode: ReceiptsSortMode;
  receiptsCategoryFilter: ReceiptCategory | null;

  // lazy caches (null = not yet computed, cleared on refresh)
  cachedAdvisorReport: AdvisorReport | null;
  cachedFocusReport: FocusReport | null;
  cachedExplainReport: ExplainReport | null;
  cachedCompareOutput: CompareOutput | null;
  cachedMoreStats: MoreStats | null;
  cachedReplayReport: ReplayReport | null;
  cachedWasteReport: WasteReport | null;
  cachedNutritionReport: NutritionReport | null;
  cachedReceipt: Receipt | null;
}

export const WINDOW_LABELS = ['1D', '7D', '30D', '90D', 'ALL'] as const;
export const WINDOW_DAYS = [1, 7, 30, 90, 0] as const;
export const DEFAULT_WINDOW_INDEX = 1;

export function createInitialState(): AppState {
  return {
    selectedWindowIndex: DEFAULT_WINDOW_INDEX,
    selectedView: 'overview',
    isLoading: true,
    data: null,
    sortMode: 'cost',
    modelScrollOffset: 0,
    explainDate: null,
    focusScrollOffset: 0,
    advisorScrollOffset: 0,
    nutritionScrollOffset: 0,
    nutritionSignalsLoading: false,
    nutritionSignalsLoadedKeys: new Set(),
    compareScrollOffset: 0,
    viewTasks: {
      pendingKeys: new Set(),
      errors: {},
      activeLabel: null,
    },
    matrixPage: 0,
    showHelp: false,
    wrappedScrollOffset: 0,
    exportStatus: null,
    showCursorSetup: false,
    cursorSetupField: 'token',
    cursorSetupLabel: '',
    cursorSetupToken: '',
    cursorSetupMessage: null,
    cursorSetupSubmitting: false,
    cursorSetupStatusOverride: null,
    replayDate: null,
    replayScrollOffset: 0,
    replayExpandedBlocks: new Set(),
    receiptsScrollOffset: 0,
    receiptsExpandedLineIndex: null,
    receiptsSortMode: 'cost',
    receiptsCategoryFilter: null,
    cachedAdvisorReport: null,
    cachedFocusReport: null,
    cachedExplainReport: null,
    cachedCompareOutput: null,
    cachedMoreStats: null,
    cachedReplayReport: null,
    cachedWasteReport: null,
    cachedNutritionReport: null,
    cachedReceipt: null,
  };
}
