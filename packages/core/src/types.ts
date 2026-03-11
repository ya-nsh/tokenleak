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
}

export interface RenderOptions {
  format: 'json' | 'svg' | 'png' | 'terminal';
  theme: 'dark' | 'light';
  width: number;
  showInsights: boolean;
  noColor: boolean;
  output: string | null;
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
