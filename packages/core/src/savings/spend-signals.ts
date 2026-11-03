import type { ProviderData } from '../types';
import { formatUsd } from '../format';
import { recipe, type Finding } from './shared';

/** One model above this share of spend is a concentration risk. */
const CONCENTRATION_SHARE = 0.85;
/** The second half of the window averaging this much above the first is a rising trend. */
const RISING_COST_GROWTH = 0.2;
/** Trends need at least this many days with spend to mean anything. */
const MIN_TREND_DAYS = 4;
/** A day costing this many times the daily average is a burst. */
const BURST_MULTIPLIER = 3;

function dailyCosts(providers: readonly ProviderData[]): Map<string, number> {
  const costs = new Map<string, number>();
  for (const provider of providers) {
    for (const day of provider.daily) {
      costs.set(day.date, (costs.get(day.date) ?? 0) + day.cost);
    }
  }
  return costs;
}

function modelCosts(providers: readonly ProviderData[]): Map<string, number> {
  const costs = new Map<string, number>();
  for (const provider of providers) {
    for (const day of provider.daily) {
      for (const model of day.models) {
        costs.set(model.model, (costs.get(model.model) ?? 0) + model.cost);
      }
    }
  }
  return costs;
}

function detectConcentration(providers: readonly ProviderData[], totalCost: number): Finding[] {
  if (totalCost <= 0) return [];
  const [top] = [...modelCosts(providers).entries()].sort((a, b) => b[1] - a[1]);
  if (!top || top[1] / totalCost <= CONCENTRATION_SHARE) return [];
  const [model, cost] = top;
  return [
    {
      kind: 'cost-concentration',
      title: `High concentration on ${model}`,
      severity: 'low',
      confidence: 'medium',
      estimatedSavings: null,
      evidence: {
        model,
        eventCount: 0,
        tokens: 0,
        cost,
        reason: `${model} accounts for ${Math.round((cost / totalCost) * 100)}% of spend, so one price change moves your whole bill.`,
      },
      recipes: [
        recipe(
          'Check which work needs it',
          'Simulate routing to see how much of this model’s usage a cheaper model could take.',
          'tokenleak simulate-routing',
        ),
      ],
    },
  ];
}

function detectRisingCost(costs: ReadonlyMap<string, number>): Finding[] {
  const dates = [...costs.keys()].sort();
  if (dates.length < MIN_TREND_DAYS) return [];
  const mid = Math.floor(dates.length / 2);
  const average = (slice: string[]): number =>
    slice.reduce((sum, date) => sum + (costs.get(date) ?? 0), 0) / slice.length;
  const firstAvg = average(dates.slice(0, mid));
  const secondAvg = average(dates.slice(mid));
  if (firstAvg <= 0 || (secondAvg - firstAvg) / firstAvg <= RISING_COST_GROWTH) return [];
  return [
    {
      kind: 'rising-cost',
      title: 'Rising cost trend',
      severity: 'medium',
      confidence: 'medium',
      estimatedSavings: null,
      evidence: {
        date: dates[mid],
        eventCount: 0,
        tokens: 0,
        cost: secondAvg,
        reason: `Average daily cost rose from ${formatUsd(firstAvg)} to ${formatUsd(secondAvg)} between the first and second half of the window.`,
      },
      recipes: [
        recipe(
          'Compare the two halves',
          'Look for a model, provider, or project whose share grew in the recent half.',
          `tokenleak --compare ${dates[0]}..${dates[mid - 1]}`,
        ),
      ],
    },
  ];
}

function detectBurstDays(costs: ReadonlyMap<string, number>, averageDailyCost: number): Finding[] {
  if (averageDailyCost <= 0) return [];
  const bursts = [...costs.entries()]
    .filter(([, cost]) => cost > averageDailyCost * BURST_MULTIPLIER)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const peak = bursts[0];
  if (!peak) return [];
  const [peakDate, peakCost] = peak;
  const count = bursts.length;
  return [
    {
      kind: 'burst-day',
      title: `${count} burst day${count === 1 ? '' : 's'}`,
      severity: 'low',
      confidence: 'low',
      estimatedSavings: null,
      evidence: {
        date: peakDate,
        eventCount: 0,
        tokens: 0,
        cost: peakCost,
        reason:
          `${count} day${count === 1 ? '' : 's'} cost more than ${BURST_MULTIPLIER}x the ${formatUsd(averageDailyCost)} daily average. ` +
          `Peak: ${peakDate} at ${formatUsd(peakCost)}.`,
      },
      recipes: [
        recipe(
          'Review the peak day',
          'Inspect its costliest sessions for repeated failed loops, broad file reads, or model overuse.',
          `tokenleak explain ${peakDate}`,
        ),
      ],
    },
  ];
}

/** Whole-window spend patterns. They carry no savings estimate; they point at where to look. */
export function detectSpendFindings(
  providers: readonly ProviderData[],
  analyzedDays: number,
): Finding[] {
  const costs = dailyCosts(providers);
  const totalCost = [...costs.values()].reduce((sum, cost) => sum + cost, 0);
  return [
    ...detectConcentration(providers, totalCost),
    ...detectRisingCost(costs),
    ...detectBurstDays(costs, analyzedDays > 0 ? totalCost / analyzedDays : 0),
  ];
}
