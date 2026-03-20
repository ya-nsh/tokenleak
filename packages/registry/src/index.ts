export const REGISTRY_VERSION = '0.2.0';

export {
  normalizeModelName,
  MODEL_PRICING,
  getModelPricing,
  TOKENS_PER_MILLION,
  estimateCost,
  estimateCostBreakdown,
} from './models';

export type { ModelPricing, CostBreakdown } from './models';

export type { IProvider } from './provider';
export { ProviderRegistry } from './registry';
export { splitJsonlRecords } from './parsers/index';
export { ClaudeCodeProvider, CodexProvider, CursorProvider, OpenCodeProvider, PiProvider } from './providers/index';
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
