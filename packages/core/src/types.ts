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
  sessionId?: string;
  projectId?: string;
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
  modelMixShift: ModelMixShiftEntry[];
}

export interface MoreStats {
  inputOutput: InputOutputMetrics;
  monthlyBurn: MonthlyBurnMetrics;
  cacheEconomics: CacheEconomics;
  hourOfDay: HourOfDayEntry[];
  sessionMetrics: SessionMetrics;
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
  format: 'json' | 'svg' | 'png' | 'terminal';
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
