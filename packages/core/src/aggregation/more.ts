import type {
  AggregatedStats,
  CacheRoiBreakdown,
  CacheRoiMetrics,
  CacheRoiSummary,
  CompareDeltas,
  DateRange,
  MoreStats,
  ProviderData,
  UsageEvent,
  ModelMixShiftEntry,
  SessionSummary,
} from '../types';

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

function buildSessionMetrics(events: UsageEvent[]): MoreStats['sessionMetrics'] {
  const sessions = new Map<string, {
    label: string;
    tokens: number;
    cost: number;
    count: number;
    projectId?: string;
    firstTimestamp: number;
    lastTimestamp: number;
    explicitDurationMs: number;
    hasExplicitDuration: boolean;
  }>();
  const projects = new Map<string, number>();

  for (const event of events) {
    const key = event.sessionId?.trim() || `${event.provider}:${event.timestamp}`;
    const timestamp = Date.parse(event.timestamp);
    const safeTime = Number.isFinite(timestamp) ? timestamp : 0;
    const projectId = event.projectId?.trim() || undefined;

    let session = sessions.get(key);
    if (!session) {
      session = {
        label: projectId || event.sessionId?.trim() || key,
        tokens: 0,
        cost: 0,
        count: 0,
        projectId,
        firstTimestamp: safeTime,
        lastTimestamp: safeTime,
        explicitDurationMs: 0,
        hasExplicitDuration: false,
      };
      sessions.set(key, session);
    } else if (!session.projectId && projectId) {
      session.projectId = projectId;
      session.label = projectId || event.sessionId?.trim() || key;
    }

    session.tokens += event.totalTokens;
    session.cost += event.cost;
    session.count += 1;
    session.firstTimestamp = Math.min(session.firstTimestamp, safeTime);
    session.lastTimestamp = Math.max(session.lastTimestamp, safeTime);

    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) {
      session.explicitDurationMs += Math.max(0, event.durationMs);
      session.hasExplicitDuration = true;
    }

    if (projectId) {
      projects.set(projectId, (projects.get(projectId) ?? 0) + event.totalTokens);
    }
  }

  const sessionEntries = [...sessions.values()];
  const totalSessions = sessionEntries.length;

  let totalTokens = 0;
  let totalCost = 0;
  let totalMessages = 0;
  let durationTotal = 0;
  let durationCount = 0;
  let longestSession: SessionSummary | null = null;
  let longestSessionDuration = -1;

  for (const session of sessionEntries) {
    totalTokens += session.tokens;
    totalCost += session.cost;
    totalMessages += session.count;

    const derivedDurationMs = session.hasExplicitDuration
      ? session.explicitDurationMs
      : session.lastTimestamp > session.firstTimestamp
        ? session.lastTimestamp - session.firstTimestamp
        : 0;

    if (derivedDurationMs > 0) {
      durationTotal += derivedDurationMs;
      durationCount += 1;
    }

    if (
      derivedDurationMs > longestSessionDuration ||
      (derivedDurationMs === longestSessionDuration &&
        (!longestSession || session.tokens > longestSession.tokens))
    ) {
      longestSessionDuration = derivedDurationMs;
      longestSession = {
        label: session.label,
        tokens: session.tokens,
        cost: session.cost,
        count: session.count,
        durationMs: derivedDurationMs > 0 ? derivedDurationMs : null,
      };
    }
  }

  const projectBreakdown = [...projects.entries()]
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  const topProject = projectBreakdown[0] ?? null;

  return {
    totalSessions,
    averageTokens: totalSessions > 0 ? totalTokens / totalSessions : 0,
    averageCost: totalSessions > 0 ? totalCost / totalSessions : 0,
    averageMessages: totalSessions > 0 ? totalMessages / totalSessions : 0,
    averageDurationMs: durationCount > 0 ? durationTotal / durationCount : null,
    longestSession,
    projectCount: projects.size,
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

  return {
    inputOutput: buildInputOutput(providers),
    monthlyBurn: buildMonthlyBurn(providers, range),
    cacheEconomics: buildCacheEconomics(providers),
    cacheRoi: buildCacheRoi(providers, events),
    hourOfDay: buildHourOfDay(events),
    sessionMetrics: buildSessionMetrics(events),
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
