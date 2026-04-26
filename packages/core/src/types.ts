export interface DailyUsage {
  date: string; // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  models: ModelBreakdown[];
}

export interface ModelBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  pricing?: CachePricingDetails | null;
  costSource?: CostSource;
  pricedTokens?: number;
  unpricedTokens?: number;
}

export interface CachePricingDetails {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ProviderData {
  provider: string;
  displayName: string;
  daily: DailyUsage[];
  totalTokens: number;
  totalCost: number;
  colors: ProviderColors;
  events?: UsageEvent[];
  warnings?: ProviderWarning[];
  costCompleteness?: CostCompleteness;
}

export type ProviderWarningKind = 'parse' | 'oversize' | 'read' | 'provider-load' | 'unknown-pricing';

export interface ProviderWarning {
  kind: ProviderWarningKind;
  file: string;
  count: number;
}

export type CostSource = 'provider-reported' | 'estimated' | 'unpriced';

export interface CostCompleteness {
  status: 'complete' | 'partial' | 'unknown';
  totalTokens: number;
  pricedTokens: number;
  unpricedTokens: number;
  unknownModels: string[];
}

export interface ProviderColors {
  primary: string;
  secondary: string;
  gradient: [string, string];
}

export interface AggregatedStats {
  currentStreak: number;
  longestStreak: number;
  rolling30dTokens: number;
  rolling30dCost: number;
  rolling7dTokens: number;
  rolling7dCost: number;
  peakDay: { date: string; tokens: number } | null;
  averageDailyTokens: number;
  averageDailyCost: number;
  cacheHitRate: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  totalDays: number;
  activeDays: number;
  dayOfWeek: DayOfWeekEntry[];
  topModels: TopModelEntry[];
  rolling30dTopModel: string | null;
  costCompleteness?: CostCompleteness;
}

export interface UsageEvent {
  provider: string;
  timestamp: string;
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  pricing?: CachePricingDetails | null;
  costSource?: CostSource;
  pricedTokens?: number;
  unpricedTokens?: number;
  sessionId?: string;
  projectId?: string;
  repoRoot?: string;
  directory?: string;
  durationMs?: number;
  /** The most recent user prompt that triggered this assistant response, if captured by the parser. */
  prompt?: string;
}

export interface DayOfWeekEntry {
  day: number; // 0=Sunday, 6=Saturday
  label: string;
  tokens: number;
  cost: number;
  count: number;
}

export interface TopModelEntry {
  model: string;
  tokens: number;
  cost: number;
  percentage: number;
}

export interface InputOutputMetrics {
  inputPerOutput: number | null;
  outputPerInput: number | null;
  outputShare: number;
}

export interface MonthlyBurnMetrics {
  projectedTokens: number;
  projectedCost: number;
  observedDays: number;
  calendarDays: number;
}

export interface CacheEconomics {
  readTokens: number;
  writeTokens: number;
  readCoverage: number;
  reuseRatio: number | null;
}

export interface HourOfDayEntry {
  hour: number;
  tokens: number;
  cost: number;
  count: number;
}

export interface SessionSummary {
  label: string;
  tokens: number;
  cost: number;
  count: number;
  durationMs: number | null;
}

export interface ProjectSummary {
  name: string;
  tokens: number;
}

export interface ModelEfficiencyEntry {
  model: string;
  eventCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  outputInputRatio: number;
  outputPerDollar: number;
  cacheCoverage: number;
  costPer1MTotal: number;
  score: number;
  scoreBreakdown: {
    outputPerDollar: number;
    outputInputRatio: number;
    cacheCoverage: number;
  };
}

export interface ModelEfficiencyMetrics {
  method: string;
  rankings: ModelEfficiencyEntry[];
  ineligibleModels: Array<{
    model: string;
    eventCount: number;
    totalTokens: number;
    reason: string;
  }>;
}

export interface CacheRoiSummary {
  readTokens: number;
  writeTokens: number;
  readSavings: number;
  writeCost: number;
  netSavings: number;
  reuseRatio: number | null;
  paybackRatio: number | null;
}

export interface CacheRoiBreakdown extends CacheRoiSummary {
  label: string;
}

export interface CacheRoiMetrics {
  method: string;
  summary: CacheRoiSummary;
  byProvider: CacheRoiBreakdown[];
  byModel: CacheRoiBreakdown[];
  byProject: CacheRoiBreakdown[];
}

export interface SessionMetrics {
  totalSessions: number;
  averageTokens: number;
  averageCost: number;
  averageMessages: number;
  averageDurationMs: number | null;
  longestSession: SessionSummary | null;
  projectCount: number;
  topProject: ProjectSummary | null;
  projectBreakdown: ProjectSummary[];
}

export interface SessionDrilldownEntry {
  sessionId: string;
  label: string;
  provider: string;
  projectId: string | null;
  repoRoot: string | null;
  directory: string | null;
  start: string;
  end: string;
  durationMs: number | null;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  topModels: TopModelEntry[];
}

export interface ProjectDrilldownEntry {
  projectId: string;
  repoRoot: string | null;
  directory: string | null;
  sessionCount: number;
  activeDays: number;
  streak: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  topModels: TopModelEntry[];
  topSessions: SessionSummary[];
}

export interface AttributionWindow {
  start: string;
  end: string;
  sessionCount: number;
}

export type AttributionTaskStyle = 'quick-hit' | 'iterative' | 'deep-work' | 'mixed';

export interface AttributionCluster {
  clusterId: string;
  label: string;
  taskStyle: AttributionTaskStyle;
  repoRoot: string | null;
  directory: string | null;
  sessionCount: number;
  activeDays: number;
  tokens: number;
  cost: number;
  providers: string[];
  models: string[];
  timeWindows: AttributionWindow[];
}

export interface ExplainEvidenceRow {
  label: string;
  tokens: number;
  cost: number;
  share: number;
}

export interface ExplainAnomaly {
  type: 'provider-spike' | 'model-spike' | 'cache-drop' | 'long-session' | 'dense-session';
  title: string;
  detail: string;
}

export interface ExplainReport {
  date: string;
  totalTokens: number;
  totalCost: number;
  comparedTo7dAverage: number;
  comparedTo30dAverage: number;
  headline: string;
  summary: string[];
  topProviders: ExplainEvidenceRow[];
  topSessions: ExplainEvidenceRow[];
  topProjects: ExplainEvidenceRow[];
  topModels: ExplainEvidenceRow[];
  anomalies: ExplainAnomaly[];
}

export interface FocusEntry {
  sessionId: string;
  label: string;
  provider: string;
  projectId: string | null;
  repoRoot: string | null;
  start: string;
  end: string;
  durationMs: number | null;
  tokensPerHour: number;
  totalTokens: number;
  cost: number;
  streak: number;
  score: number;
  scoreBreakdown: {
    duration: number;
    density: number;
    streak: number;
  };
  rationale: string[];
}

export interface FocusReport {
  method: string;
  entries: FocusEntry[];
}

export type FlowBlockLabel = 'Deep Flow' | 'Quick Lookup' | 'Moderate Session';

export interface FlowBlock {
  blockIndex: number;
  label: FlowBlockLabel;
  start: string;
  end: string;
  durationMs: number;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  dominantModel: string;
  events: UsageEvent[];
  modelSwitches: number;
  cacheHitRateTrend: number[];
}

export interface TokenVelocityPoint {
  minute: string;
  tokensPerMinute: number;
}

export interface ReplayDaySummary {
  totalSessions: number;
  totalEvents: number;
  flowTimeMs: number;
  thinkTimeMs: number;
  flowThinkRatio: number;
  peakMinute: TokenVelocityPoint | null;
}

export interface ReplayReport {
  date: string;
  events: UsageEvent[];
  flowBlocks: FlowBlock[];
  tokenVelocity: TokenVelocityPoint[];
  summary: ReplayDaySummary;
}

export interface CommonsPrivacyBlock {
  containsPrompts: false;
  containsPaths: false;
  containsRepoNames: false;
  containsSessionIds: false;
  containsExactTimestamps: false;
  granularity: 'aggregate-v1';
}

export interface CommonsBucketEntry {
  label: string;
  count: number;
}

export interface CommonsProviderModelEntry {
  provider: string;
  model: string;
  tokensBucket: string;
  costBucket: string;
  cacheHitRateBucket: string;
  eventCountBucket: string;
}

export interface CommonsExport {
  schemaVersion: 1;
  generated: string;
  dateRange: DateRange;
  privacy: CommonsPrivacyBlock;
  totals: {
    tokensBucket: string;
    costBucket: string;
    activeDaysBucket: string;
    providerCount: number;
    cacheHitRateBucket: string;
  };
  providerModels: CommonsProviderModelEntry[];
  dayOfWeek: CommonsBucketEntry[];
  hourOfDay: CommonsBucketEntry[];
  projectBuckets: CommonsBucketEntry[];
  sessionBuckets: CommonsBucketEntry[];
}

export interface CommonsInspectReport {
  valid: boolean;
  errors: string[];
  summary: {
    providerModels: number;
    dayOfWeekBuckets: number;
    hourOfDayBuckets: number;
    projectBuckets: number;
    sessionBuckets: number;
  };
}

export type WasteCategory =
  | 'premium-short-output'
  | 'low-cache-hit-rate'
  | 'wasted-cache-writes'
  | 'context-drag'
  | 'burst-spike'
  | 'model-switch-churn';

export interface WasteRecipe {
  title: string;
  command?: string;
  detail: string;
}

export interface WasteFinding {
  category: WasteCategory;
  severity: 'high' | 'medium' | 'low';
  title: string;
  evidence: string;
  provider?: string;
  model?: string;
  projectId?: string;
  estimatedMonthlySavings: number | null;
  recipes: WasteRecipe[];
}

export interface WasteReport {
  method: string;
  dateRange: DateRange;
  enoughEvidence: boolean;
  findings: WasteFinding[];
}

export interface NutritionOutcomeSignal {
  repoRoot: string;
  commits: number;
  changedFiles: number;
  changedLines: number;
}

export interface NutritionRepoSummary {
  repoRoot: string | null;
  label: string;
  providers: string[];
  models: string[];
  sessions: number;
  tokens: number;
  cost: number;
  commits: number;
  changedFiles: number;
  changedLines: number;
  tokensPerCommit: number | null;
  costPerCommit: number | null;
  tokensPerChangedLine: number | null;
  costPerChangedLine: number | null;
}

export interface NutritionReport {
  method: string;
  dateRange: DateRange;
  totals: {
    tokens: number;
    cost: number;
    commits: number;
    changedFiles: number;
    changedLines: number;
    tokensPerCommit: number | null;
    costPerCommit: number | null;
    tokensPerChangedLine: number | null;
    costPerChangedLine: number | null;
  };
  repos: NutritionRepoSummary[];
  missingOutcomeRepos: string[];
}

export interface ModelMixShiftEntry {
  model: string;
  currentShare: number;
  previousShare: number;
  deltaShare: number;
  currentTokens: number;
  previousTokens: number;
}

export interface CompareMore {
  previousRange: DateRange;
  previousStats: AggregatedStats;
  deltas: CompareDeltas;
  modelMixShift: ModelMixShiftEntry[];
}

export interface MoreStats {
  inputOutput: InputOutputMetrics;
  monthlyBurn: MonthlyBurnMetrics;
  cacheEconomics: CacheEconomics;
  hourOfDay: HourOfDayEntry[];
  sessionMetrics: SessionMetrics;
  modelEfficiency?: ModelEfficiencyMetrics | null;
  cacheRoi?: CacheRoiMetrics | null;
  sessionDrilldown: SessionDrilldownEntry[];
  projectDrilldown: ProjectDrilldownEntry[];
  attribution?: AttributionCluster[] | null;
  compare: CompareMore | null;
}

export interface ProviderResult {
  provider: string;
  data: ProviderData | null;
  error: string | null;
}

export interface TokenleakOutput {
  schemaVersion: number;
  generated: string; // ISO timestamp
  dateRange: DateRange;
  providers: ProviderData[];
  aggregated: AggregatedStats;
  more?: MoreStats | null;
}

export interface RenderOptions {
  format: 'json' | 'svg' | 'png' | 'terminal' | 'wrapped';
  theme: 'dark' | 'light';
  width: number;
  showInsights: boolean;
  noColor: boolean;
  output: string | null;
  more?: boolean;
}

export interface DateRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

export interface CompareOutput {
  schemaVersion: number;
  generated: string;
  periodA: { range: DateRange; stats: AggregatedStats };
  periodB: { range: DateRange; stats: AggregatedStats };
  deltas: CompareDeltas;
}

export interface CompareDeltas {
  tokens: number;
  cost: number;
  streak: number;
  activeDays: number;
  averageDailyTokens: number;
  cacheHitRate: number;
}
