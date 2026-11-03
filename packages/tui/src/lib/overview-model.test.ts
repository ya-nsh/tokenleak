import { describe, expect, test } from 'bun:test';
import type { DailyUsage, SavingsReport, SavingsRecommendation } from '@tokenleak/core';
import {
  CHART_MODEL_LIMIT,
  OTHER_MODELS,
  buildKpis,
  buildOverviewData,
  buildStackedSeries,
  cacheHitRate,
  datesInRange,
  daysInRange,
  modelRows,
  peakDay,
  previousRange,
  providerRows,
  relativeChange,
  sumPeriod,
  topRecommendation,
} from './overview-model';
import { makeTuiData } from './__fixtures__/usage';

function day(date: string, models: Record<string, number>): DailyUsage {
  const entries = Object.entries(models).map(([model, cost]) => ({
    model,
    inputTokens: cost * 10,
    outputTokens: cost * 5,
    cacheReadTokens: cost * 20,
    cacheWriteTokens: 0,
    totalTokens: cost * 35,
    cost,
  }));
  const sum = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'totalTokens' | 'cost') =>
    entries.reduce((total, entry) => total + entry[key], 0);
  return {
    date,
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    totalTokens: sum('totalTokens'),
    cost: sum('cost'),
    models: entries,
  };
}

describe('periods', () => {
  test('previous range has the same length and ends the day before, across a month boundary', () => {
    const range = { since: '2026-11-01', until: '2026-11-07' };
    expect(daysInRange(range)).toBe(7);
    expect(previousRange(range)).toEqual({ since: '2026-10-25', until: '2026-10-31' });
  });

  test('a one-day range compares with the day before, across a year boundary', () => {
    expect(previousRange({ since: '2026-01-01', until: '2026-01-01' })).toEqual({ since: '2025-12-31', until: '2025-12-31' });
  });

  test('dates fill gaps between active days', () => {
    expect(datesInRange({ since: '2026-02-27', until: '2026-03-02' })).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  test('sums only days inside the range and counts active days', () => {
    const daily = [day('2026-11-01', { a: 1 }), day('2026-11-02', { a: 2 }), day('2026-11-05', { a: 4 })];
    const totals = sumPeriod(daily, { since: '2026-11-02', until: '2026-11-04' });
    expect(totals.cost).toBe(2);
    expect(totals.activeDays).toBe(1);
    expect(sumPeriod([], { since: '2026-11-01', until: '2026-11-02' }).cost).toBe(0);
  });

  test('cache hit rate is 0 without prompt tokens and 100% when all cached', () => {
    const empty = sumPeriod([], { since: '2026-11-01', until: '2026-11-01' });
    expect(cacheHitRate(empty)).toBe(0);
    expect(cacheHitRate({ ...empty, cacheRead: 10 })).toBe(1);
  });

  test('relative change is null without an earlier value', () => {
    expect(relativeChange(10, 0)).toBeNull();
    expect(relativeChange(15, 10)).toBeCloseTo(0.5);
    expect(relativeChange(5, 10)).toBeCloseTo(-0.5);
  });
});

describe('buildStackedSeries', () => {
  test('stacks the top models and folds the rest into other, with zero days for gaps', () => {
    const models = Object.fromEntries(Array.from({ length: CHART_MODEL_LIMIT + 2 }, (_, i) => [`m${i}`, 10 - i]));
    const series = buildStackedSeries([day('2026-11-01', models), day('2026-11-03', { m0: 1 })], { since: '2026-11-01', until: '2026-11-03' }, 'cost');
    expect(series.models).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', OTHER_MODELS]);
    expect(series.days.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    // m5 and m6 (worth 5 and 4) fold into other.
    expect(series.days[0]!.values.at(-1)).toBe(5 + 4);
    expect(series.days[1]!.total).toBe(0);
    expect(series.max).toBe(series.days[0]!.total);
  });

  test('has no other series when every model fits', () => {
    const series = buildStackedSeries([day('2026-11-01', { a: 1, b: 2 })], { since: '2026-11-01', until: '2026-11-01' }, 'tokens');
    expect(series.models).toEqual(['b', 'a']);
    expect(series.days[0]!.values).toEqual([70, 35]);
  });

  test('an empty window has no models and a zero max', () => {
    const series = buildStackedSeries([], { since: '2026-11-01', until: '2026-11-02' }, 'cost');
    expect(series.models).toEqual([]);
    expect(series.max).toBe(0);
  });
});

describe('share rows and peaks', () => {
  test('model rows sum across days in range, sorted by the metric, with shares', () => {
    const rows = modelRows([day('2026-11-01', { a: 1, b: 3 }), day('2026-11-02', { a: 4 })], { since: '2026-11-01', until: '2026-11-02' }, 'cost');
    expect(rows.map((row) => [row.label, row.cost, row.share])).toEqual([
      ['a', 5, 5 / 8],
      ['b', 3, 3 / 8],
    ]);
  });

  test('provider rows drop providers without usage in the window', () => {
    const data = makeTuiData('2026-11-03');
    const rows = providerRows(data.providers, { since: '2026-11-03', until: '2026-11-03' }, 'cost');
    expect(rows.map((row) => row.key)).toEqual(['claude-code', 'codex']);
    expect(providerRows(data.providers, { since: '2026-10-01', until: '2026-10-02' }, 'cost')).toEqual([]);
  });

  test('the peak day prefers the most recent of ties and is null without usage', () => {
    const range = { since: '2026-11-01', until: '2026-11-03' };
    expect(peakDay([day('2026-11-01', { a: 2 }), day('2026-11-02', { a: 2 })], range, 'cost')?.date).toBe('2026-11-02');
    expect(peakDay([], range, 'cost')).toBeNull();
  });
});

describe('buildOverviewData and buildKpis', () => {
  test('compares a trailing window with the period before it', () => {
    const data = makeTuiData('2026-11-03');
    const overview = buildOverviewData(data, 1, 'cost')!;
    expect(overview.hasPrevious).toBe(true);
    expect(overview.range).toEqual({ since: '2026-10-28', until: '2026-11-03' });
    const kpis = buildKpis(overview, '7D', 3);
    expect(kpis.map((kpi) => kpi.label)).toEqual(['Spend', 'Tokens', 'Cache hit', 'Active', 'Peak day']);
    expect(kpis[0]!.change).not.toBeNull();
    expect(kpis[3]!.value).toBe('7/7');
    expect(kpis[3]!.note).toBe('3-day streak');
  });

  test('ALL has no previous period, so no change', () => {
    const overview = buildOverviewData(makeTuiData('2026-11-03'), 4, 'cost')!;
    expect(overview.hasPrevious).toBe(false);
    expect(buildKpis(overview, 'ALL', 0).every((kpi) => kpi.change === null)).toBe(true);
  });

  test('a missing window yields null', () => {
    expect(buildOverviewData(makeTuiData('2026-11-03'), 9, 'cost')).toBeNull();
  });
});

describe('topRecommendation', () => {
  const rec = (title: string, monthlySavings: number | null) => ({ title, monthlySavings }) as SavingsRecommendation;
  test('picks the largest monthly saving and tolerates unknown amounts', () => {
    const report = { recommendations: [rec('a', null), rec('b', 40), rec('c', 12)] } as SavingsReport;
    expect(topRecommendation(report)?.title).toBe('b');
    expect(topRecommendation({ recommendations: [] } as unknown as SavingsReport)).toBeNull();
    expect(topRecommendation(null)).toBeNull();
  });
});
