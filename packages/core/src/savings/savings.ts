import type {
  DateRange,
  ProviderData,
  RoutingSimulationReport,
  SavingsRecommendation,
  SavingsReport,
  UsageEvent,
} from '../types';
import { inclusiveDaySpan } from '../date-utils';
import { buildRoutingSimulationReport, type RoutingModelPricing } from './routing-simulator';
import { sessionKey } from '../aggregation/session-identity';
import { detectCacheFindings } from './cache-signals';
import { detectRoutingFindings } from './routing-signals';
import { detectSessionFindings } from './session-signals';
import { DAYS_PER_MONTH, KIND_CATEGORY, type Finding } from './shared';
import { detectSpendFindings } from './spend-signals';

const METHOD =
  'Savings engine v1: deterministic findings from local events. Routing re-prices each event on a cheaper model; ' +
  'cache savings use your own input and cache-read rates; session findings estimate a share of the affected cost. ' +
  'Findings can overlap, so the total is capped at current cost. These are leads, not proof of bad usage.';

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 } as const;

export interface BuildSavingsReportInput {
  providers: readonly ProviderData[];
  dateRange: DateRange;
  /** Rates for routing targets, keyed by normalized model name. */
  pricing: Readonly<Record<string, RoutingModelPricing>>;
  /** Defaults to every provider's events. */
  events?: readonly UsageEvent[];
  /** A routing simulation already built for these events, to avoid re-running it. */
  routing?: RoutingSimulationReport;
}

function toMonthly(amount: number, analyzedDays: number): number {
  return analyzedDays > 0 ? (amount / analyzedDays) * DAYS_PER_MONTH : 0;
}

function rank(recommendations: SavingsRecommendation[]): SavingsRecommendation[] {
  return recommendations.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      (b.estimatedSavings ?? 0) - (a.estimatedSavings ?? 0) ||
      b.evidence.tokens - a.evidence.tokens ||
      a.title.localeCompare(b.title),
  );
}

/** How much of the analyzed usage could be priced. */
function summarizePricingCoverage(
  events: readonly UsageEvent[],
): Pick<SavingsReport['summary'], 'pricedTokenShare' | 'unpricedModels'> {
  let totalTokens = 0;
  let unpricedTokens = 0;
  const unpricedByModel = new Map<string, number>();
  for (const event of events) {
    totalTokens += event.totalTokens;
    const unpriced = event.unpricedTokens ?? 0;
    if (unpriced > 0) {
      unpricedTokens += unpriced;
      unpricedByModel.set(event.model, (unpricedByModel.get(event.model) ?? 0) + unpriced);
    }
  }
  return {
    pricedTokenShare: totalTokens > 0 ? Math.max(0, 1 - unpricedTokens / totalTokens) : 1,
    unpricedModels: [...unpricedByModel.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([model]) => model),
  };
}

/**
 * Run every savings detector over one window of usage and return a single
 * ranked list. `--advisor`, `tokenleak waste` and the routing summary are
 * views over this report.
 */
export function buildSavingsReport(input: BuildSavingsReportInput): SavingsReport {
  const events = input.events ?? input.providers.flatMap((provider) => provider.events ?? []);
  const analyzedDays = Math.max(1, inclusiveDaySpan(input.dateRange.since, input.dateRange.until));
  const warnings: string[] = [];
  const routing =
    input.routing ??
    buildRoutingSimulationReport([...events], input.dateRange, input.pricing, {
      strategy: 'conservative',
    });

  const findings: Finding[] = [
    ...detectRoutingFindings(routing),
    ...detectCacheFindings(input.providers),
    ...detectSessionFindings(events, warnings),
    ...detectSpendFindings(input.providers, analyzedDays),
  ];
  const recommendations = rank(
    findings.map((finding) => ({
      ...finding,
      category: KIND_CATEGORY[finding.kind],
      monthlySavings:
        finding.estimatedSavings === null
          ? null
          : toMonthly(finding.estimatedSavings, analyzedDays),
    })),
  );

  const currentCost = input.providers.reduce((sum, provider) => sum + provider.totalCost, 0);
  const estimable = recommendations
    .map((recommendation) => recommendation.estimatedSavings)
    .filter((value): value is number => value !== null);
  const estimatedSavings =
    estimable.length > 0
      ? Math.min(
          currentCost,
          estimable.reduce((sum, value) => sum + value, 0),
        )
      : null;
  if (routing.warnings.includes('Savings are calculated on the priced subset only.')) {
    warnings.push('Routing savings cover only models with a known downgrade path and price.');
  }

  return {
    method: METHOD,
    dateRange: input.dateRange,
    summary: {
      totalRecommendations: recommendations.length,
      highSeverity: recommendations.filter((recommendation) => recommendation.severity === 'high')
        .length,
      currentCost,
      currentMonthlyCost: toMonthly(currentCost, analyzedDays),
      estimatedSavings,
      monthlySavings: estimatedSavings === null ? null : toMonthly(estimatedSavings, analyzedDays),
      analyzedDays,
      analyzedEvents: events.length,
      analyzedSessions: new Set(
        events.map((event) => sessionKey(event.provider, event.sessionId ?? event.date)),
      ).size,
      ...summarizePricingCoverage(events),
    },
    recommendations,
    warnings: [...new Set(warnings)],
  };
}

/** Below this priced share, "no recommendations" would be a claim the data cannot back. */
const MIN_PRICED_SHARE_FOR_VERDICT = 0.99;
const MAX_NAMED_UNPRICED_MODELS = 3;

/**
 * Explain why the report's numbers are partial, or null when pricing
 * coverage is good enough to trust them.
 */
export function describePricingGap(report: SavingsReport): string | null {
  const { pricedTokenShare, unpricedModels } = report.summary;
  if (pricedTokenShare >= MIN_PRICED_SHARE_FOR_VERDICT) return null;
  const unpricedPercent = Math.round((1 - pricedTokenShare) * 100);
  const named = unpricedModels.slice(0, MAX_NAMED_UNPRICED_MODELS);
  const more = unpricedModels.length - named.length;
  const models =
    named.length > 0 ? ` (${named.join(', ')}${more > 0 ? ` +${more} more` : ''})` : '';
  return (
    `${Math.max(1, unpricedPercent)}% of tokens have no known price${models}, so savings are understated. ` +
    'Run `tokenleak pricing` to see sources, or add rates to ~/.config/tokenleak/pricing.json.'
  );
}

/** Recommendations at one severity, or all of them for `'all'`. */
export function filterBySeverity(
  report: SavingsReport,
  severity: 'all' | SavingsRecommendation['severity'],
): SavingsReport {
  if (severity === 'all') return report;
  const recommendations = report.recommendations.filter(
    (recommendation) => recommendation.severity === severity,
  );
  return { ...report, recommendations };
}
