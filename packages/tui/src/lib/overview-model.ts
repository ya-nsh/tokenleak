import type { DailyUsage, DateRange, ProviderData, SavingsReport, SavingsRecommendation } from '@tokenleak/core';
import { shiftDateStringLocal } from '@tokenleak/core';
import type { TuiData } from './data.js';
import { formatCost, formatPercent, formatShortDate, formatTokens } from './format.js';

export type OverviewMetric = 'cost' | 'tokens';

/** How many models get their own colour in the chart; the rest are "other". */
export const CHART_MODEL_LIMIT = 5;
export const OTHER_MODELS = 'other';

export interface Kpi {
  label: string;
  value: string;
  /** Fractional change vs the previous period of equal length; null when there is none. */
  change: number | null;
  /** Whether a rise is good (cache hit), bad (spend) or neither (volume). */
  direction: 'up-good' | 'up-bad' | 'neutral';
  /** Secondary line under the value, used when there is no change to show. */
  note?: string;
}

export interface PeriodTotals {
  cost: number;
  tokens: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  activeDays: number;
}

export interface StackedDay {
  date: string;
  /** Value per chart model, in {@link StackedSeries.models} order. */
  values: number[];
  total: number;
}

export interface StackedSeries {
  /** The top models by window total, then {@link OTHER_MODELS} if anything else had usage. */
  models: string[];
  days: StackedDay[];
  max: number;
}

export interface ShareRow {
  key: string;
  label: string;
  cost: number;
  tokens: number;
  /** This row's part of the column total for the active metric, 0..1. */
  share: number;
}

export function sumPeriod(daily: readonly DailyUsage[], range: DateRange): PeriodTotals {
  const totals: PeriodTotals = { cost: 0, tokens: 0, input: 0, cacheRead: 0, cacheWrite: 0, activeDays: 0 };
  for (const day of daily) {
    if (day.date < range.since || day.date > range.until) continue;
    totals.cost += day.cost;
    totals.tokens += day.totalTokens;
    totals.input += day.inputTokens;
    totals.cacheRead += day.cacheReadTokens;
    totals.cacheWrite += day.cacheWriteTokens;
    if (day.totalTokens > 0 || day.cost > 0) totals.activeDays += 1;
  }
  return totals;
}

/** Share of prompt tokens served from cache, matching the aggregated stats. */
export function cacheHitRate(totals: PeriodTotals): number {
  const prompt = totals.input + totals.cacheRead + totals.cacheWrite;
  return prompt > 0 ? totals.cacheRead / prompt : 0;
}

/** Inclusive day count of a range. */
export function daysInRange(range: DateRange): number {
  const start = Date.parse(`${range.since}T00:00:00Z`);
  const end = Date.parse(`${range.until}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

/** The period of the same length that ends the day before `range` starts. */
export function previousRange(range: DateRange): DateRange {
  const days = daysInRange(range);
  return {
    since: shiftDateStringLocal(range.since, -days),
    until: shiftDateStringLocal(range.since, -1),
  };
}

/** Relative change, or null when the earlier value is zero (no meaningful ratio). */
export function relativeChange(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous : null;
}

/** Every date in the range, so days without usage still take a column. */
export function datesInRange(range: DateRange): string[] {
  const dates: string[] = [];
  for (let date = range.since; date <= range.until; date = shiftDateStringLocal(date, 1)) dates.push(date);
  return dates;
}

/**
 * Daily values stacked by model for the chart: the {@link CHART_MODEL_LIMIT}
 * biggest models by the window total of `metric`, everything else folded
 * into {@link OTHER_MODELS}, and a zero day for every date without usage.
 */
export function buildStackedSeries(
  daily: readonly DailyUsage[],
  range: DateRange,
  metric: OverviewMetric,
): StackedSeries {
  const valueOf = (entry: { cost: number; totalTokens: number }) => (metric === 'cost' ? entry.cost : entry.totalTokens);
  const totals = new Map<string, number>();
  for (const day of daily) {
    for (const model of day.models) totals.set(model.model, (totals.get(model.model) ?? 0) + valueOf(model));
  }
  const ranked = [...totals.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([model]) => model);
  const named = ranked.slice(0, CHART_MODEL_LIMIT);
  const models = ranked.length > CHART_MODEL_LIMIT ? [...named, OTHER_MODELS] : named;
  const slot = new Map(named.map((model, index) => [model, index]));
  const otherSlot = models.length - 1;

  const byDate = new Map(daily.map((day) => [day.date, day]));
  let max = 0;
  const days = datesInRange(range).map((date): StackedDay => {
    const values: number[] = models.map(() => 0);
    for (const model of byDate.get(date)?.models ?? []) {
      const index = slot.get(model.model) ?? (ranked.length > CHART_MODEL_LIMIT ? otherSlot : -1);
      if (index >= 0) values[index]! += valueOf(model);
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    max = Math.max(max, total);
    return { date, values, total };
  });
  return { models, days, max };
}

function shareRows(rows: Omit<ShareRow, 'share'>[], metric: OverviewMetric): ShareRow[] {
  const total = rows.reduce((sum, row) => sum + row[metric], 0);
  return rows
    .map((row) => ({ ...row, share: total > 0 ? row[metric] / total : 0 }))
    .sort((a, b) => b[metric] - a[metric] || a.label.localeCompare(b.label));
}

export function providerRows(providers: readonly ProviderData[], range: DateRange, metric: OverviewMetric): ShareRow[] {
  return shareRows(
    providers
      .map((provider) => {
        const totals = sumPeriod(provider.daily, range);
        return { key: provider.provider, label: provider.displayName, cost: totals.cost, tokens: totals.tokens };
      })
      .filter((row) => row.cost > 0 || row.tokens > 0),
    metric,
  );
}

export function modelRows(daily: readonly DailyUsage[], range: DateRange, metric: OverviewMetric): ShareRow[] {
  const byModel = new Map<string, { cost: number; tokens: number }>();
  for (const day of daily) {
    if (day.date < range.since || day.date > range.until) continue;
    for (const model of day.models) {
      const entry = byModel.get(model.model) ?? { cost: 0, tokens: 0 };
      entry.cost += model.cost;
      entry.tokens += model.totalTokens;
      byModel.set(model.model, entry);
    }
  }
  return shareRows(
    [...byModel.entries()].map(([model, totals]) => ({ key: model, label: model, ...totals })),
    metric,
  );
}

/** The day with the highest value of `metric` in the range, or null without usage. */
export function peakDay(daily: readonly DailyUsage[], range: DateRange, metric: OverviewMetric): DailyUsage | null {
  let peak: DailyUsage | null = null;
  for (const day of daily) {
    if (day.date < range.since || day.date > range.until) continue;
    const value = metric === 'cost' ? day.cost : day.totalTokens;
    if (value > 0 && (!peak || value >= (metric === 'cost' ? peak.cost : peak.totalTokens))) peak = day;
  }
  return peak;
}

/** The recommendation worth the most per month, for the Overview's savings line. */
export function topRecommendation(report: SavingsReport | null): SavingsRecommendation | null {
  if (!report) return null;
  let best: SavingsRecommendation | null = null;
  for (const recommendation of report.recommendations) {
    const value = recommendation.monthlySavings ?? -1;
    if (!best || value > (best.monthlySavings ?? -1)) best = recommendation;
  }
  return best;
}

export interface OverviewData {
  range: DateRange;
  /** False for ALL, which has no earlier period to compare with. */
  hasPrevious: boolean;
  current: PeriodTotals;
  previous: PeriodTotals;
  series: StackedSeries;
  providers: ShareRow[];
  models: ShareRow[];
  peak: DailyUsage | null;
}

/** Everything the Overview shows for one window, from slim TUI data alone. */
export function buildOverviewData(data: TuiData, windowIndex: number, metric: OverviewMetric): OverviewData | null {
  const window = data.windows[windowIndex];
  if (!window) return null;
  const range = window.dateRange;
  const hasPrevious = window.days > 0;
  const prior = previousRange(range);
  return {
    range,
    hasPrevious,
    current: sumPeriod(data.mergedDaily, range),
    previous: hasPrevious ? sumPeriod(data.mergedDaily, prior) : sumPeriod([], prior),
    series: buildStackedSeries(window.daily ?? data.mergedDaily, range, metric),
    providers: providerRows(data.providers, range, metric),
    models: modelRows(data.mergedDaily, range, metric),
    peak: peakDay(data.mergedDaily, range, metric),
  };
}

/** The headline tiles: spend, tokens, cache hit, activity and the peak day. */
export function buildKpis(overview: OverviewData, windowLabel: string, streak: number): Kpi[] {
  const { current, previous, hasPrevious, range, peak } = overview;
  const change = (now: number, before: number) => (hasPrevious ? relativeChange(now, before) : null);
  const days = daysInRange(range);
  return [
    {
      label: 'Spend',
      value: formatCost(current.cost),
      change: change(current.cost, previous.cost),
      direction: 'up-bad',
      note: hasPrevious ? `none in prior ${windowLabel}` : `${formatCost(current.cost / days)}/day avg`,
    },
    {
      label: 'Tokens',
      value: formatTokens(current.tokens),
      change: change(current.tokens, previous.tokens),
      direction: 'neutral',
      note: hasPrevious ? `none in prior ${windowLabel}` : `${formatTokens(current.tokens / days)}/day avg`,
    },
    {
      label: 'Cache hit',
      value: formatPercent(cacheHitRate(current)),
      change: change(cacheHitRate(current), cacheHitRate(previous)),
      direction: 'up-good',
      note: 'of prompt tokens',
    },
    {
      label: 'Active',
      value: `${current.activeDays}/${days}`,
      change: null,
      direction: 'neutral',
      note: streak > 0 ? `${streak}-day streak` : 'no current streak',
    },
    {
      label: 'Peak day',
      value: peak ? formatShortDate(peak.date) : '—',
      change: null,
      direction: 'neutral',
      note: peak ? `${formatCost(peak.cost)} · ${formatTokens(peak.totalTokens)}` : 'no usage yet',
    },
  ];
}
