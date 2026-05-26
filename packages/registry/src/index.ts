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
  GeminiProvider,
  CopilotProvider,
  AmpProvider,
  CodebuffProvider,
  DroidProvider,
  QwenProvider,
  RooCodeProvider,
  KiloCodeProvider,
  KimiProvider,
  KiloProvider,
  MuxProvider,
  CrushProvider,
  OpenClawProvider,
  HermesProvider,
  GooseProvider,
  AntigravityProvider,
  ZedProvider,
  KiroProvider,
  TraeProvider,
  SyntheticProvider,
  OpenCodeProvider,
  PiProvider,
} from './providers/index';
export {
  classifyCursorNetworkError,
  CursorAuthError,
  diagnoseCursorConnection,
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
  resolveCursorNetworkSettings,
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
  CursorDiagnosticCheck,
  CursorDiagnosticResult,
  CursorFailureReason,
  CursorNetworkClassification,
  CursorNetworkFailureKind,
  CursorNetworkSettings,
  CursorSetupState,
  CursorSetupStatus,
  SyncCursorResult,
  ValidateCursorSessionResult,
} from './cursor-auth';
