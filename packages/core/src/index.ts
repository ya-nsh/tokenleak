export const VERSION = '1.0.2';

export type {
  DailyUsage,
  ModelBreakdown,
  ProviderData,
  ProviderColors,
  AggregatedStats,
  DayOfWeekEntry,
  TopModelEntry,
  UsageEvent,
  InputOutputMetrics,
  MonthlyBurnMetrics,
  CacheEconomics,
  HourOfDayEntry,
  SessionSummary,
  ProjectSummary,
  SessionMetrics,
  ModelMixShiftEntry,
  CompareMore,
  MoreStats,
  ProviderResult,
  TokenleakOutput,
  RenderOptions,
  DateRange,
  CompareOutput,
  CompareDeltas,
} from './types';

export {
  DEFAULT_DAYS,
  DEFAULT_CONCURRENCY,
  MAX_JSONL_RECORD_BYTES,
  SCHEMA_VERSION,
} from './constants';

export {
  calculateStreaks,
  rollingWindow,
  findPeakDay,
  dayOfWeekBreakdown,
  cacheHitRate,
  calculateAverages,
  topModels,
  aggregate,
  mergeProviderData,
  compareRanges,
  computeDeltas,
  buildCompareOutput,
  parseCompareRange,
  computePreviousPeriod,
  buildMoreStats,
  computeModelMixShift,
} from './aggregation';

export {
  ONE_DAY_MS,
  dateToUtcMs,
  formatDateStringUtc,
  compareDateStrings,
} from './date-utils';
