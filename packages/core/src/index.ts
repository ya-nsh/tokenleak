export const VERSION = '0.1.0';

export type {
  DailyUsage,
  ModelBreakdown,
  ProviderData,
  ProviderColors,
  AggregatedStats,
  DayOfWeekEntry,
  TopModelEntry,
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
  computeDeltas,
  buildCompareOutput,
  parseCompareRange,
  computePreviousPeriod,
} from './aggregation';
