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
  sessionId?: string;
  projectId?: string;
  repoRoot?: string;
  directory?: string;
  durationMs?: number;
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
