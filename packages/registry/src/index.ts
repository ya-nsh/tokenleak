export const REGISTRY_VERSION = '0.2.0';

export {
  normalizeModelName,
  MODEL_PRICING,
  getModelPricing,
  TOKENS_PER_MILLION,
  estimateCost,
  estimateCostBreakdown,
  initPricing,
  resetPricingState,
} from './models';

export type { ModelPricing, CostBreakdown } from './models';

export type { IProvider } from './provider';
export type { ClaudeQuotaSnapshot, CodexQuotaSnapshot, QuotaWindowSnapshot } from './providers/index';
export { ProviderRegistry } from './registry';
export { GitCorrelator, parseGitLog } from './git-correlator';
export type {
  GitCommit,
  GitCorrelatorOptions,
  SessionLike,
  ShipStatus,
} from './git-correlator';
export { splitJsonlRecords } from './parsers/index';
export {
  ClaudeCodeProvider,
  CodexProvider,
  CursorProvider,
  OpenCodeProvider,
  PiProvider,
  extractClaudeQuotaSnapshot,
  extractCodexQuotaSnapshot,
} from './providers/index';
export {
  CursorAuthError,
  getActiveCursorCredentials,
  getCursorCacheDir,
  getCursorCredentialsFor,
  getCursorCredentialsPath,
  hasCursorUsageCache,
  isCursorAuthFailureReason,
  isCursorLoggedIn,
  listCursorAccounts,
  loadCursorCredentialsStore,
  removeAllCursorAccounts,
  removeCursorAccount,
  resetCursorProviderState,
  resolveCursorSetupStatus,
  saveCursorCredentials,
  saveCursorCredentialsStore,
  setActiveCursorAccount,
  shouldSyncCursorForRun,
  syncCursorCache,
  validateCursorSession,
} from './cursor-auth';
export type {
  CursorAccountInfo,
  CursorCredentials,
  CursorCredentialsStore,
  CursorFailureReason,
  CursorSetupState,
  CursorSetupStatus,
  SyncCursorResult,
  ValidateCursorSessionResult,
} from './cursor-auth';
