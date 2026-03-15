import type {
  AggregatedStats,
  CacheRoiBreakdown,
  CacheRoiMetrics,
  CacheRoiSummary,
  CompareDeltas,
  DateRange,
  MoreStats,
  ModelMixShiftEntry,
  ProjectDrilldownEntry,
  ProviderData,
  SessionDrilldownEntry,
  SessionSummary,
  UsageEvent,
} from '../types';
import { buildProjectRollups, buildSessionRollups, normalizeScores } from './analytics';

const MIN_MODEL_EFFICIENCY_EVENTS = 2;
const MIN_MODEL_EFFICIENCY_TOTAL_TOKENS = 1_000;

const MODEL_EFFICIENCY_METHOD =
  `Eligible models need at least ${MIN_MODEL_EFFICIENCY_EVENTS} events, ` +
  `${MIN_MODEL_EFFICIENCY_TOTAL_TOKENS} total tokens, non-zero input/output tokens, and positive cost. ` +
  'Score is the mean of normalized output per dollar, output/input ratio, and cache coverage.';

const TOKENS_PER_MILLION = 1_000_000;

interface CacheRoiAccumulator {
  readTokens: number;
  writeTokens: number;
  readSavings: number;
  writeCost: number;
}

function daysInMonth(dateString: string): number {
  const [year, month] = dateString.split('-').map(Number);
  if (!year || !month) {
    return 30;
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildInputOutput(providers: ProviderData[]): MoreStats['inputOutput'] {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const provider of providers) {
    for (const day of provider.daily) {
      inputTokens += day.inputTokens;
      outputTokens += day.outputTokens;
    }
  }

  const nonCacheTokens = inputTokens + outputTokens;
  return {
    inputPerOutput: outputTokens > 0 ? inputTokens / outputTokens : null,
    outputPerInput: inputTokens > 0 ? outputTokens / inputTokens : null,
    outputShare: nonCacheTokens > 0 ? outputTokens / nonCacheTokens : 0,
  };
}

function buildMonthlyBurn(
  providers: ProviderData[],
  range: DateRange,
): MoreStats['monthlyBurn'] {
  const monthPrefix = range.until.slice(0, 7);
  const monthStart = `${monthPrefix}-01`;
  const observedSince = range.since > monthStart ? range.since : monthStart;
  const observedDays =
    Math.max(
      1,
      Math.round(
        (Date.parse(`${range.until}T00:00:00Z`) - Date.parse(`${observedSince}T00:00:00Z`)) /
          86_400_000,
      ) + 1,
    );

  let observedTokens = 0;
  let observedCost = 0;
  for (const provider of providers) {
    for (const day of provider.daily) {
      if (day.date >= observedSince && day.date <= range.until) {
        observedTokens += day.totalTokens;
        observedCost += day.cost;
      }
    }
  }

  const calendarDays = daysInMonth(range.until);
  const tokensPerDay = observedTokens / observedDays;
  const costPerDay = observedCost / observedDays;

  return {
    projectedTokens: tokensPerDay * calendarDays,
    projectedCost: costPerDay * calendarDays,
    observedDays,
    calendarDays,
  };
}

function buildCacheEconomics(providers: ProviderData[]): MoreStats['cacheEconomics'] {
  let readTokens = 0;
  let writeTokens = 0;
  let inputTokens = 0;

  for (const provider of providers) {
    for (const day of provider.daily) {
      readTokens += day.cacheReadTokens;
      writeTokens += day.cacheWriteTokens;
      inputTokens += day.inputTokens;
    }
  }

  const readCoverage = readTokens + inputTokens > 0 ? readTokens / (readTokens + inputTokens) : 0;
  return {
    readTokens,
    writeTokens,
    readCoverage,
    reuseRatio: writeTokens > 0 ? readTokens / writeTokens : null,
  };
}

function createCacheRoiAccumulator(): CacheRoiAccumulator {
  return {
    readTokens: 0,
    writeTokens: 0,
    readSavings: 0,
    writeCost: 0,
  };
}

function addCacheRoiUsage(
  accumulator: CacheRoiAccumulator,
  readTokens: number,
  writeTokens: number,
  pricing: UsageEvent['pricing'] | ProviderData['daily'][number]['models'][number]['pricing'],
): void {
  if (!pricing || (!readTokens && !writeTokens)) {
    return;
  }

  accumulator.readTokens += readTokens;
  accumulator.writeTokens += writeTokens;
  accumulator.readSavings += (readTokens / TOKENS_PER_MILLION) * (pricing.input - pricing.cacheRead);
  accumulator.writeCost += (writeTokens / TOKENS_PER_MILLION) * pricing.cacheWrite;
}

function finalizeCacheRoi(
  accumulator: CacheRoiAccumulator,
): CacheRoiSummary {
  return {
    readTokens: accumulator.readTokens,
    writeTokens: accumulator.writeTokens,
    readSavings: accumulator.readSavings,
    writeCost: accumulator.writeCost,
    netSavings: accumulator.readSavings - accumulator.writeCost,
    reuseRatio: accumulator.writeTokens > 0 ? accumulator.readTokens / accumulator.writeTokens : null,
    paybackRatio: accumulator.writeCost > 0 ? accumulator.readSavings / accumulator.writeCost : null,
  };
}

function sortCacheRoiBreakdowns(
  breakdowns: CacheRoiBreakdown[],
): CacheRoiBreakdown[] {
  return breakdowns.sort((left, right) => {
    if (right.netSavings !== left.netSavings) {
      return right.netSavings - left.netSavings;
    }
    if (right.readSavings !== left.readSavings) {
      return right.readSavings - left.readSavings;
    }
    if (right.readTokens !== left.readTokens) {
      return right.readTokens - left.readTokens;
    }
    return left.label.localeCompare(right.label);
  });
}

function buildCacheRoi(
  providers: ProviderData[],
  events: UsageEvent[],
): CacheRoiMetrics | null {
  const summary = createCacheRoiAccumulator();
  const byProvider = new Map<string, CacheRoiAccumulator>();
  const byModel = new Map<string, CacheRoiAccumulator>();
  const byProject = new Map<string, CacheRoiAccumulator>();

  for (const provider of providers) {
    const providerAccumulator = byProvider.get(provider.displayName) ?? createCacheRoiAccumulator();
    byProvider.set(provider.displayName, providerAccumulator);

    for (const day of provider.daily) {
      for (const model of day.models) {
        addCacheRoiUsage(summary, model.cacheReadTokens, model.cacheWriteTokens, model.pricing);
        addCacheRoiUsage(providerAccumulator, model.cacheReadTokens, model.cacheWriteTokens, model.pricing);

        const modelAccumulator = byModel.get(model.model) ?? createCacheRoiAccumulator();
        byModel.set(model.model, modelAccumulator);
        addCacheRoiUsage(modelAccumulator, model.cacheReadTokens, model.cacheWriteTokens, model.pricing);
      }
    }
  }

  for (const event of events) {
    const projectLabel = event.projectId?.trim() || event.repoRoot?.trim() || event.directory?.trim();
    if (!projectLabel) {
      continue;
    }

    const projectAccumulator = byProject.get(projectLabel) ?? createCacheRoiAccumulator();
    byProject.set(projectLabel, projectAccumulator);
    addCacheRoiUsage(projectAccumulator, event.cacheReadTokens, event.cacheWriteTokens, event.pricing);
  }

  const summaryMetrics = finalizeCacheRoi(summary);
  if (summaryMetrics.readTokens === 0 && summaryMetrics.writeTokens === 0) {
    return null;
  }

  return {
    method: 'cache-pricing-v1',
    summary: summaryMetrics,
    byProvider: sortCacheRoiBreakdowns(
      [...byProvider.entries()]
        .map(([label, accumulator]) => ({ label, ...finalizeCacheRoi(accumulator) }))
        .filter((entry) => entry.readTokens > 0 || entry.writeTokens > 0),
    ),
    byModel: sortCacheRoiBreakdowns(
      [...byModel.entries()]
        .map(([label, accumulator]) => ({ label, ...finalizeCacheRoi(accumulator) }))
        .filter((entry) => entry.readTokens > 0 || entry.writeTokens > 0),
    ),
    byProject: sortCacheRoiBreakdowns(
      [...byProject.entries()]
        .map(([label, accumulator]) => ({ label, ...finalizeCacheRoi(accumulator) }))
        .filter((entry) => entry.readTokens > 0 || entry.writeTokens > 0),
    ),
  };
}

function collectEvents(providers: ProviderData[]): UsageEvent[] {
  return providers.flatMap((provider) => provider.events ?? []);
}

function buildHourOfDay(events: UsageEvent[]): MoreStats['hourOfDay'] {
  const buckets: MoreStats['hourOfDay'] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    tokens: 0,
    cost: 0,
    count: 0,
  }));

  for (const event of events) {
    const date = new Date(event.timestamp);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    const bucket = buckets[date.getUTCHours()];
    if (!bucket) {
      continue;
    }
    bucket.tokens += event.totalTokens;
    bucket.cost += event.cost;
    bucket.count += 1;
  }

  return buckets;
}

function buildSessionMetrics(
  sessionDrilldown: SessionDrilldownEntry[],
  projectDrilldown: ProjectDrilldownEntry[],
): MoreStats['sessionMetrics'] {
  const totalSessions = sessionDrilldown.length;

  let totalTokens = 0;
  let totalCost = 0;
  let totalMessages = 0;
  let durationTotal = 0;
  let durationCount = 0;
  let longestSession: SessionSummary | null = null;
  let longestSessionDuration = -1;

  for (const session of sessionDrilldown) {
    totalTokens += session.totalTokens;
    totalCost += session.cost;
    totalMessages += session.eventCount;

    if (typeof session.durationMs === 'number' && session.durationMs > 0) {
      durationTotal += session.durationMs;
      durationCount += 1;
    }

    if (
      (session.durationMs ?? 0) > longestSessionDuration ||
      ((session.durationMs ?? 0) === longestSessionDuration &&
        (!longestSession || session.totalTokens > longestSession.tokens))
    ) {
      longestSessionDuration = session.durationMs ?? 0;
      longestSession = {
        label: session.label,
        tokens: session.totalTokens,
        cost: session.cost,
        count: session.eventCount,
        durationMs: session.durationMs,
      };
    }
  }

  const projectBreakdown = projectDrilldown
    .map((project) => ({ name: project.projectId, tokens: project.totalTokens }))
    .slice(0, 10);

  const topProject = projectBreakdown[0] ?? null;

  return {
    totalSessions,
    averageTokens: totalSessions > 0 ? totalTokens / totalSessions : 0,
    averageCost: totalSessions > 0 ? totalCost / totalSessions : 0,
    averageMessages: totalSessions > 0 ? totalMessages / totalSessions : 0,
    averageDurationMs: durationCount > 0 ? durationTotal / durationCount : null,
    longestSession,
    projectCount: projectDrilldown.length,
    topProject,
    projectBreakdown,
  };
}

function buildModelEfficiency(events: UsageEvent[]): NonNullable<MoreStats['modelEfficiency']> {
  const byModel = new Map<string, {
    model: string;
    eventCount: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    cost: number;
  }>();

  for (const event of events) {
    let model = byModel.get(event.model);
    if (!model) {
      model = {
        model: event.model,
        eventCount: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
      };
      byModel.set(event.model, model);
    }

    model.eventCount += 1;
    model.totalTokens += event.totalTokens;
    model.inputTokens += event.inputTokens;
    model.outputTokens += event.outputTokens;
    model.cacheReadTokens += event.cacheReadTokens;
    model.cacheWriteTokens += event.cacheWriteTokens;
    model.cost += event.cost;
  }

  const eligible = [...byModel.values()];
  const rankingsBase: Array<{
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
  }> = [];
  const ineligibleModels: NonNullable<MoreStats['modelEfficiency']>['ineligibleModels'] = [];

  for (const model of eligible) {
    const reasons: string[] = [];

    if (model.eventCount < MIN_MODEL_EFFICIENCY_EVENTS) {
      reasons.push(`needs at least ${MIN_MODEL_EFFICIENCY_EVENTS} events`);
    }
    if (model.totalTokens < MIN_MODEL_EFFICIENCY_TOTAL_TOKENS) {
      reasons.push(`needs at least ${MIN_MODEL_EFFICIENCY_TOTAL_TOKENS} total tokens`);
    }
    if (model.inputTokens <= 0) {
      reasons.push('needs input tokens');
    }
    if (model.outputTokens <= 0) {
      reasons.push('needs output tokens');
    }
    if (model.cost <= 0) {
      reasons.push('needs positive cost');
    }

    if (reasons.length > 0) {
      ineligibleModels.push({
        model: model.model,
        eventCount: model.eventCount,
        totalTokens: model.totalTokens,
        reason: reasons.join('; '),
      });
      continue;
    }

    rankingsBase.push({
      model: model.model,
      eventCount: model.eventCount,
      totalTokens: model.totalTokens,
      inputTokens: model.inputTokens,
      outputTokens: model.outputTokens,
      cacheReadTokens: model.cacheReadTokens,
      cacheWriteTokens: model.cacheWriteTokens,
      cost: model.cost,
      outputInputRatio: model.outputTokens / model.inputTokens,
      outputPerDollar: model.outputTokens / model.cost,
      cacheCoverage:
        model.inputTokens + model.cacheReadTokens > 0
          ? model.cacheReadTokens / (model.inputTokens + model.cacheReadTokens)
          : 0,
      costPer1MTotal: model.totalTokens > 0 ? (model.cost / model.totalTokens) * 1_000_000 : 0,
    });
  }

  const outputPerDollarScores = normalizeScores(rankingsBase.map((entry) => entry.outputPerDollar));
  const outputInputScores = normalizeScores(rankingsBase.map((entry) => entry.outputInputRatio));
  const cacheCoverageScores = normalizeScores(rankingsBase.map((entry) => entry.cacheCoverage));

  const rankings = rankingsBase
    .map((entry, index) => {
      const scoreBreakdown = {
        outputPerDollar: outputPerDollarScores[index] ?? 0,
        outputInputRatio: outputInputScores[index] ?? 0,
        cacheCoverage: cacheCoverageScores[index] ?? 0,
      };
      const score =
        (scoreBreakdown.outputPerDollar +
          scoreBreakdown.outputInputRatio +
          scoreBreakdown.cacheCoverage) /
        3;

      return {
        ...entry,
        score,
        scoreBreakdown,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.outputPerDollar !== a.outputPerDollar) {
        return b.outputPerDollar - a.outputPerDollar;
      }
      return b.totalTokens - a.totalTokens;
    });

  ineligibleModels.sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) {
      return b.totalTokens - a.totalTokens;
    }
    return b.eventCount - a.eventCount;
  });

  return {
    method: MODEL_EFFICIENCY_METHOD,
    rankings,
    ineligibleModels,
  };
}

export function computeModelMixShift(
  currentProviders: ProviderData[],
  previousProviders: ProviderData[],
  limit: number = 5,
): ModelMixShiftEntry[] {
  const currentModelTokens = new Map<string, number>();
  const previousModelTokens = new Map<string, number>();

  let currentTotal = 0;
  let previousTotal = 0;

  for (const provider of currentProviders) {
    for (const day of provider.daily) {
      for (const model of day.models) {
        currentModelTokens.set(model.model, (currentModelTokens.get(model.model) ?? 0) + model.totalTokens);
        currentTotal += model.totalTokens;
      }
    }
  }

  for (const provider of previousProviders) {
    for (const day of provider.daily) {
      for (const model of day.models) {
        previousModelTokens.set(model.model, (previousModelTokens.get(model.model) ?? 0) + model.totalTokens);
        previousTotal += model.totalTokens;
      }
    }
  }

  const models = new Set([
    ...currentModelTokens.keys(),
    ...previousModelTokens.keys(),
  ]);

  return [...models]
    .map((model) => {
      const currentTokens = currentModelTokens.get(model) ?? 0;
      const previousTokens = previousModelTokens.get(model) ?? 0;
      const currentShare = currentTotal > 0 ? currentTokens / currentTotal : 0;
      const previousShare = previousTotal > 0 ? previousTokens / previousTotal : 0;

      return {
        model,
        currentShare,
        previousShare,
        deltaShare: currentShare - previousShare,
        currentTokens,
        previousTokens,
      };
    })
    .sort((a, b) => Math.abs(b.deltaShare) - Math.abs(a.deltaShare))
    .slice(0, limit);
}

export function buildMoreStats(
  providers: ProviderData[],
  range: DateRange,
  compare: {
    previousRange: DateRange;
    previousProviders: ProviderData[];
    previousStats: AggregatedStats;
    deltas: CompareDeltas;
  } | null = null,
): MoreStats {
  const events = collectEvents(providers);
  const sessionDrilldown = buildSessionRollups(events);
  const projectDrilldown = buildProjectRollups(events);

  return {
    inputOutput: buildInputOutput(providers),
    monthlyBurn: buildMonthlyBurn(providers, range),
    cacheEconomics: buildCacheEconomics(providers),
    cacheRoi: buildCacheRoi(providers, events),
    hourOfDay: buildHourOfDay(events),
    sessionMetrics: buildSessionMetrics(sessionDrilldown, projectDrilldown),
    sessionDrilldown,
    projectDrilldown,
    modelEfficiency: buildModelEfficiency(events),
    compare: compare
      ? {
          previousRange: compare.previousRange,
          previousStats: compare.previousStats,
          deltas: compare.deltas,
          modelMixShift: computeModelMixShift(providers, compare.previousProviders),
        }
      : null,
  };
}
