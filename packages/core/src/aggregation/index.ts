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
export { buildWasteReport } from './waste';
export { buildNutritionReport } from './nutrition';
export { collectGitOutcomeSignals } from './nutrition-git';
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
export { CATEGORY_LABELS, CATEGORY_LABELS_SHORT, formatReceiptDollars } from './receipt-labels';
export {
  buildSessionRollups,
  buildProjectRollups,
  buildAttributionClusters,
  inferRepoRoot,
  inferDirectoryLabel,
  normalizeScores,
} from './analytics';
