import type {
  AggregatedStats,
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
import { buildProjectRollups, buildSessionRollups } from './analytics';

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
    hourOfDay: buildHourOfDay(events),
    sessionMetrics: buildSessionMetrics(sessionDrilldown, projectDrilldown),
    sessionDrilldown,
    projectDrilldown,
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
