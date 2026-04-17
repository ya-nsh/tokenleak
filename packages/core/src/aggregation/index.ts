export { calculateStreaks } from './streaks';
export { rollingWindow } from './rolling-window';
export { findPeakDay } from './peaks';
export { dayOfWeekBreakdown } from './day-of-week';
export { cacheHitRate } from './cache-rate';
export { calculateAverages } from './averages';
export { topModels } from './top-models';
export { aggregate } from './aggregate';
export { mergeProviderData } from './merge';
export { compareRanges, computeDeltas, buildCompareOutput, parseCompareRange, computePreviousPeriod } from './compare';
export { buildMoreStats, computeModelMixShift } from './more';
export { buildExplainReport } from './explain';
export { buildFocusReport } from './focus';
export { buildReplayReport } from './replay';
export { clusterPrompts, tokenBigrams } from './prompt-clusters';
export type { PromptCluster, ClusterOptions } from './prompt-clusters';
export { buildReceipt } from './receipt-lines';
export type {
  Receipt,
  ReceiptLine,
  ReceiptSummary,
  ReceiptCategory,
  BuildReceiptOptions,
} from './receipt-lines';
export {
  buildSessionRollups,
  buildProjectRollups,
  buildAttributionClusters,
  inferRepoRoot,
  inferDirectoryLabel,
  normalizeScores,
} from './analytics';
