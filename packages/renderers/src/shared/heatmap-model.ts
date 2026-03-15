import type { DailyUsage } from '@tokenleak/core';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface HeatmapCell {
  date: string;
  tokens: number;
  cost: number;
  level: number;
  dayIndex: number;
  weekIndex: number;
  dominantModelFamily: string | null;
  dominantModelLabel: string | null;
  dominantModelShare: number;
  mixedModelCount: number;
}

export interface HeatmapWeek {
  index: number;
  days: HeatmapCell[];
}

export interface HeatmapMonthMarker {
  label: string;
  month: number;
  year: number;
  weekIndex: number;
}

export interface HeatmapModel {
  weeks: HeatmapWeek[];
  monthMarkers: HeatmapMonthMarker[];
  maxTokens: number;
  since: string;
  until: string;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildUsageMap(daily: DailyUsage[]): Map<string, DailyUsage> {
  const map = new Map<string, DailyUsage>();
  for (const entry of daily) {
    map.set(entry.date, entry);
  }
  return map;
}

function inferModelFamily(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith('claude')) return 'Claude';
  if (
    normalized.startsWith('gpt') ||
    normalized.startsWith('o1') ||
    normalized.startsWith('o3') ||
    normalized.startsWith('o4')
  ) {
    return 'GPT';
  }
  if (normalized.startsWith('gemini')) return 'Gemini';
  if (normalized.startsWith('llama') || normalized.startsWith('meta-llama')) return 'Llama';
  if (normalized.startsWith('deepseek')) return 'DeepSeek';
  if (normalized.startsWith('qwen')) return 'Qwen';
  return 'Other';
}

function getDominantModelMeta(entry: DailyUsage | undefined): Pick<
  HeatmapCell,
  'dominantModelFamily' | 'dominantModelLabel' | 'dominantModelShare' | 'mixedModelCount'
> {
  if (!entry || entry.models.length === 0 || entry.totalTokens <= 0) {
    return {
      dominantModelFamily: null,
      dominantModelLabel: null,
      dominantModelShare: 0,
      mixedModelCount: 0,
    };
  }

  const ranked = entry.models
    .filter((model) => model.totalTokens > 0)
    .slice()
    .sort((left, right) => right.totalTokens - left.totalTokens);
  const dominant = ranked[0];

  if (!dominant) {
    return {
      dominantModelFamily: null,
      dominantModelLabel: null,
      dominantModelShare: 0,
      mixedModelCount: 0,
    };
  }

  return {
    dominantModelFamily: inferModelFamily(dominant.model),
    dominantModelLabel: dominant.model,
    dominantModelShare: dominant.totalTokens / entry.totalTokens,
    mixedModelCount: ranked.length,
  };
}

function computeQuantiles(values: number[]): number[] {
  const nonZero = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [0, 0, 0];

  const quantile = (ratio: number): number => {
    const index = Math.floor(ratio * (nonZero.length - 1));
    return nonZero[index] ?? 0;
  };

  return [quantile(0.25), quantile(0.5), quantile(0.75)];
}

function getLevel(tokens: number, quantiles: number[]): number {
  if (tokens <= 0) return 0;
  if (tokens <= quantiles[0]) return 1;
  if (tokens <= quantiles[1]) return 2;
  if (tokens <= quantiles[2]) return 3;
  return 4;
}

function alignToSunday(date: Date): Date {
  const aligned = new Date(date);
  aligned.setUTCDate(aligned.getUTCDate() - aligned.getUTCDay());
  return aligned;
}

export function buildHeatmapModel(
  daily: DailyUsage[],
  range?: { since?: string; until?: string },
): HeatmapModel | null {
  if (daily.length === 0) {
    return null;
  }

  const dates = daily.map((entry) => entry.date).sort();
  const since = range?.since ?? dates[0]!;
  const until = range?.until ?? dates[dates.length - 1]!;
  const startDate = alignToSunday(new Date(`${since}T00:00:00Z`));
  const endDate = new Date(`${until}T00:00:00Z`);
  const usageMap = buildUsageMap(daily);
  const usageValues = Array.from(usageMap.values()).map((entry) => entry.totalTokens);
  const quantiles = computeQuantiles(usageValues);
  const maxTokens = usageValues.reduce((max, value) => (value > max ? value : max), 0);
  const weeks: HeatmapWeek[] = [];
  const monthMarkers: HeatmapMonthMarker[] = [];
  let weekIndex = 0;
  let lastMonth = -1;

  for (let cursor = new Date(startDate); cursor <= endDate; weekIndex += 1) {
    const weekDays: HeatmapCell[] = [];
    const month = cursor.getUTCMonth();
    const year = cursor.getUTCFullYear();

    if (month !== lastMonth) {
      monthMarkers.push({
        label: MONTH_LABELS[month] ?? '',
        month,
        year,
        weekIndex,
      });
      lastMonth = month;
    }

    const dayCursor = new Date(cursor);
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const dateString = formatDate(dayCursor);
      const usageEntry = usageMap.get(dateString);
      const tokens = usageEntry?.totalTokens ?? 0;
      const cost = usageEntry?.cost ?? 0;
      const modelMeta = getDominantModelMeta(usageEntry);
      weekDays.push({
        date: dateString,
        tokens,
        cost,
        level: getLevel(tokens, quantiles),
        dayIndex,
        weekIndex,
        ...modelMeta,
      });
      dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
    }

    weeks.push({
      index: weekIndex,
      days: weekDays,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return {
    weeks,
    monthMarkers,
    maxTokens,
    since,
    until,
  };
}
