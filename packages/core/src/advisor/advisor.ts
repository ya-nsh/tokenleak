import type { TokenleakOutput, UsageEvent } from '../types';
import type { AdvisorModelPricing, AdvisorRecommendation, AdvisorReport } from './types';
import { getDowngradePath } from './downgrade-paths';

const TOKENS_PER_MILLION = 1_000_000;
const DAYS_PER_MONTH = 30;
const LOW_OUTPUT_THRESHOLD = 1_000;
const HIGH_CONFIDENCE_EVENTS = 20;
const MEDIUM_CONFIDENCE_EVENTS = 5;
const CACHE_HIT_LOW_THRESHOLD = 0.30;
const CACHE_REUSE_LOW_THRESHOLD = 2;
const CONCENTRATION_THRESHOLD = 0.85;
const BURST_MULTIPLIER = 3;
const COST_TREND_THRESHOLD = 0.20;
const IMPROVED_CACHE_TARGET = 0.50;

interface ModelStats {
  model: string;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
}

function collectModelStats(events: UsageEvent[]): Map<string, ModelStats> {
  const stats = new Map<string, ModelStats>();
  for (const event of events) {
    let entry = stats.get(event.model);
    if (!entry) {
      entry = {
        model: event.model,
        eventCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCost: 0,
      };
      stats.set(event.model, entry);
    }
    entry.eventCount += 1;
    entry.inputTokens += event.inputTokens;
    entry.outputTokens += event.outputTokens;
    entry.cacheReadTokens += event.cacheReadTokens;
    entry.cacheWriteTokens += event.cacheWriteTokens;
    entry.totalCost += event.cost;
  }
  return stats;
}

function calculateCostWithPricing(
  stats: ModelStats,
  pricing: AdvisorModelPricing,
): number {
  return (
    (stats.inputTokens / TOKENS_PER_MILLION) * pricing.input +
    (stats.outputTokens / TOKENS_PER_MILLION) * pricing.output +
    (stats.cacheReadTokens / TOKENS_PER_MILLION) * pricing.cacheRead +
    (stats.cacheWriteTokens / TOKENS_PER_MILLION) * pricing.cacheWrite
  );
}

function confidenceForEventCount(count: number): 'high' | 'medium' | 'low' {
  if (count >= HIGH_CONFIDENCE_EVENTS) return 'high';
  if (count >= MEDIUM_CONFIDENCE_EVENTS) return 'medium';
  return 'low';
}

function extrapolateToMonthly(cost: number, analyzedDays: number): number {
  if (analyzedDays <= 0) return 0;
  return (cost / analyzedDays) * DAYS_PER_MONTH;
}

function detectModelDowngrades(
  modelStats: Map<string, ModelStats>,
  pricing: Readonly<Record<string, AdvisorModelPricing>>,
  analyzedDays: number,
): AdvisorRecommendation[] {
  const recommendations: AdvisorRecommendation[] = [];

  for (const [model, stats] of modelStats) {
    const downgradeTo = getDowngradePath(model);
    if (!downgradeTo) continue;

    const currentPricing = pricing[model];
    const downgradePricing = pricing[downgradeTo];
    if (!currentPricing || !downgradePricing) continue;

    const avgOutput = stats.eventCount > 0 ? stats.outputTokens / stats.eventCount : 0;
    if (avgOutput >= LOW_OUTPUT_THRESHOLD) continue;

    const currentCost = calculateCostWithPricing(stats, currentPricing);
    const projectedCost = calculateCostWithPricing(stats, downgradePricing);
    const savings = currentCost - projectedCost;

    if (savings <= 0) continue;

    const monthlyCurrent = extrapolateToMonthly(currentCost, analyzedDays);
    const monthlyProjected = extrapolateToMonthly(projectedCost, analyzedDays);
    const monthlySavings = monthlyCurrent - monthlyProjected;

    recommendations.push({
      type: 'model-downgrade',
      title: `Switch ${model} to ${downgradeTo} for short sessions`,
      description:
        `You used ${model} for ${stats.eventCount} events averaging ` +
        `${Math.round(avgOutput)} output tokens. Switching to ${downgradeTo} ` +
        `for those sessions would save money.`,
      currentCost: monthlyCurrent,
      projectedCost: monthlyProjected,
      monthlySavings,
      confidence: confidenceForEventCount(stats.eventCount),
      details: {
        model,
        downgradeTo,
        eventCount: stats.eventCount,
        avgOutputTokens: Math.round(avgOutput),
        totalInputTokens: stats.inputTokens,
        totalOutputTokens: stats.outputTokens,
      },
    });
  }

  return recommendations.sort((a, b) => b.monthlySavings - a.monthlySavings);
}

function detectCacheOptimizations(
  output: TokenleakOutput,
  pricing: Readonly<Record<string, AdvisorModelPricing>>,
  analyzedDays: number,
): AdvisorRecommendation[] {
  const recommendations: AdvisorRecommendation[] = [];
  const cacheHitRate = output.aggregated.cacheHitRate;
  const cacheEconomics = output.more?.cacheEconomics;

  if (cacheHitRate >= CACHE_HIT_LOW_THRESHOLD) return recommendations;

  // Estimate savings if cache hit rate improved to target
  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  for (const provider of output.providers) {
    for (const day of provider.daily) {
      totalInputTokens += day.inputTokens;
      totalCacheReadTokens += day.cacheReadTokens;
    }
  }

  const totalAddressable = totalInputTokens + totalCacheReadTokens;
  if (totalAddressable === 0) return recommendations;

  // Current cache read tokens vs what they would be at improved rate
  const currentCacheReads = totalCacheReadTokens;
  const targetCacheReads = totalAddressable * IMPROVED_CACHE_TARGET;
  const additionalCacheReads = Math.max(0, targetCacheReads - currentCacheReads);

  // Estimate average pricing differential (input vs cache read)
  // Use first model with pricing as representative
  let avgInputPrice = 0;
  let avgCacheReadPrice = 0;
  let pricedModels = 0;
  for (const provider of output.providers) {
    for (const day of provider.daily) {
      for (const model of day.models) {
        const modelPricing = pricing[model.model];
        if (modelPricing) {
          avgInputPrice += modelPricing.input;
          avgCacheReadPrice += modelPricing.cacheRead;
          pricedModels += 1;
        }
      }
    }
  }

  if (pricedModels === 0) return recommendations;

  avgInputPrice /= pricedModels;
  avgCacheReadPrice /= pricedModels;

  const savingsPerToken = (avgInputPrice - avgCacheReadPrice) / TOKENS_PER_MILLION;
  const totalSavings = additionalCacheReads * savingsPerToken;
  const monthlySavings = extrapolateToMonthly(totalSavings, analyzedDays);

  if (monthlySavings <= 0) return recommendations;

  const hitRatePercent = Math.round(cacheHitRate * 100);

  recommendations.push({
    type: 'cache-optimization',
    title: 'Improve cache reuse ratio',
    description:
      `Your cache hit rate is ${hitRatePercent}%. ` +
      `Improving to ${Math.round(IMPROVED_CACHE_TARGET * 100)}% would save on input costs.`,
    currentCost: 0,
    projectedCost: 0,
    monthlySavings,
    confidence: 'medium',
    details: {
      currentHitRate: cacheHitRate,
      targetHitRate: IMPROVED_CACHE_TARGET,
      reuseRatio: cacheEconomics?.reuseRatio ?? null,
    },
  });

  // Additional recommendation for low reuse ratio
  if (
    cacheEconomics &&
    cacheEconomics.reuseRatio !== null &&
    cacheEconomics.reuseRatio < CACHE_REUSE_LOW_THRESHOLD
  ) {
    recommendations.push({
      type: 'cache-optimization',
      title: 'Reduce wasted cache writes',
      description:
        `Your cache reuse ratio is ${cacheEconomics.reuseRatio.toFixed(1)}x ` +
        `(reads/writes). A ratio below ${CACHE_REUSE_LOW_THRESHOLD}x means cache ` +
        `writes are not being effectively reused.`,
      currentCost: 0,
      projectedCost: 0,
      monthlySavings: 0,
      confidence: 'low',
      details: {
        reuseRatio: cacheEconomics.reuseRatio,
        readTokens: cacheEconomics.readTokens,
        writeTokens: cacheEconomics.writeTokens,
      },
    });
  }

  return recommendations;
}

function detectUsagePatterns(
  output: TokenleakOutput,
  analyzedDays: number,
): AdvisorRecommendation[] {
  const recommendations: AdvisorRecommendation[] = [];

  // Concentration risk: single model > 85% of spend
  const totalCost = output.aggregated.totalCost;
  if (totalCost > 0) {
    for (const model of output.aggregated.topModels) {
      const costShare = model.cost / totalCost;
      if (costShare > CONCENTRATION_THRESHOLD) {
        recommendations.push({
          type: 'usage-pattern',
          title: `High concentration on ${model.model}`,
          description:
            `${model.model} accounts for ${Math.round(costShare * 100)}% of your total spend. ` +
            `Consider diversifying to reduce risk from pricing changes.`,
          currentCost: 0,
          projectedCost: 0,
          monthlySavings: 0,
          confidence: 'medium',
          details: {
            model: model.model,
            costShare,
            modelCost: model.cost,
            totalCost,
          },
        });
        break; // Only flag the top one
      }
    }
  }

  // Cost trend: compare first half vs second half
  const dailyCosts = new Map<string, number>();
  for (const provider of output.providers) {
    for (const day of provider.daily) {
      dailyCosts.set(day.date, (dailyCosts.get(day.date) ?? 0) + day.cost);
    }
  }

  const sortedDates = [...dailyCosts.keys()].sort();
  if (sortedDates.length >= 4) {
    const mid = Math.floor(sortedDates.length / 2);
    const firstHalfDates = sortedDates.slice(0, mid);
    const secondHalfDates = sortedDates.slice(mid);

    let firstHalfCost = 0;
    for (const d of firstHalfDates) {
      firstHalfCost += dailyCosts.get(d) ?? 0;
    }
    let secondHalfCost = 0;
    for (const d of secondHalfDates) {
      secondHalfCost += dailyCosts.get(d) ?? 0;
    }

    const firstAvg = firstHalfDates.length > 0 ? firstHalfCost / firstHalfDates.length : 0;
    const secondAvg = secondHalfDates.length > 0 ? secondHalfCost / secondHalfDates.length : 0;

    if (firstAvg > 0 && (secondAvg - firstAvg) / firstAvg > COST_TREND_THRESHOLD) {
      recommendations.push({
        type: 'usage-pattern',
        title: 'Rising cost trend detected',
        description:
          `Your average daily cost increased from $${firstAvg.toFixed(2)} ` +
          `to $${secondAvg.toFixed(2)} between the first and second halves of the period.`,
        currentCost: 0,
        projectedCost: 0,
        monthlySavings: 0,
        confidence: 'medium',
        details: {
          firstHalfAvg: firstAvg,
          secondHalfAvg: secondAvg,
          increase: (secondAvg - firstAvg) / firstAvg,
        },
      });
    }
  }

  // Burst days: any day > 3x average
  const avgDailyCost = output.aggregated.averageDailyCost;
  if (avgDailyCost > 0) {
    const burstDays: Array<{ date: string; cost: number }> = [];
    for (const [date, cost] of dailyCosts) {
      if (cost > avgDailyCost * BURST_MULTIPLIER) {
        burstDays.push({ date, cost });
      }
    }

    if (burstDays.length > 0) {
      burstDays.sort((a, b) => b.cost - a.cost);
      const topBurst = burstDays[0]!;
      recommendations.push({
        type: 'usage-pattern',
        title: `${burstDays.length} burst day${burstDays.length > 1 ? 's' : ''} detected`,
        description:
          `${burstDays.length} day${burstDays.length > 1 ? 's' : ''} exceeded 3x your ` +
          `average daily cost ($${avgDailyCost.toFixed(2)}). ` +
          `Peak: ${topBurst.date} at $${topBurst.cost.toFixed(2)}.`,
        currentCost: 0,
        projectedCost: 0,
        monthlySavings: 0,
        confidence: 'low',
        details: {
          burstDayCount: burstDays.length,
          averageDailyCost: avgDailyCost,
          burstThreshold: avgDailyCost * BURST_MULTIPLIER,
          topBurstDate: topBurst.date,
          topBurstCost: topBurst.cost,
        },
      });
    }
  }

  return recommendations;
}

/**
 * Analyze a TokenleakOutput for efficiency improvement opportunities.
 *
 * @param output - The full tokenleak output (must include providers with events for best results)
 * @param modelPricing - Model pricing table (pass MODEL_PRICING from @tokenleak/registry)
 * @returns An AdvisorReport with recommendations and savings summary
 */
export function analyzeEfficiency(
  output: TokenleakOutput,
  modelPricing: Readonly<Record<string, AdvisorModelPricing>>,
): AdvisorReport {
  const allEvents: UsageEvent[] = output.providers.flatMap((p) => p.events ?? []);

  const sinceDateMs = Date.parse(`${output.dateRange.since}T00:00:00Z`);
  const untilDateMs = Date.parse(`${output.dateRange.until}T00:00:00Z`);
  const analyzedDays = Math.max(
    1,
    Math.round((untilDateMs - sinceDateMs) / 86_400_000) + 1,
  );

  const modelStats = collectModelStats(allEvents);

  const downgradeRecs = detectModelDowngrades(modelStats, modelPricing, analyzedDays);
  const cacheRecs = detectCacheOptimizations(output, modelPricing, analyzedDays);
  const patternRecs = detectUsagePatterns(output, analyzedDays);

  const recommendations = [...downgradeRecs, ...cacheRecs, ...patternRecs];

  const totalCurrentMonthlyCost = extrapolateToMonthly(
    output.aggregated.totalCost,
    analyzedDays,
  );

  const totalMonthlySavings = recommendations.reduce(
    (sum, r) => sum + r.monthlySavings,
    0,
  );

  const totalProjectedMonthlyCost = Math.max(0, totalCurrentMonthlyCost - totalMonthlySavings);

  return {
    recommendations,
    totalCurrentMonthlyCost,
    totalProjectedMonthlyCost,
    totalMonthlySavings,
    analyzedDays,
    analyzedEvents: allEvents.length,
  };
}
