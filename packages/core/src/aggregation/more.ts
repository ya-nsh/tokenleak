import type {
  DateRange,
  MoreStats,
  ProviderData,
  UsageEvent,
  ModelMixShiftEntry,
  SessionSummary,
} from '../types';

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
  } | null = null,
): MoreStats {
  const events = collectEvents(providers);

  return {
    inputOutput: buildInputOutput(providers),
    monthlyBurn: buildMonthlyBurn(providers, range),
    cacheEconomics: buildCacheEconomics(providers),
    hourOfDay: buildHourOfDay(events),
    sessionMetrics: buildSessionMetrics(events),
    compare: compare
      ? {
          previousRange: compare.previousRange,
          modelMixShift: computeModelMixShift(providers, compare.previousProviders),
        }
      : null,
  };
}
