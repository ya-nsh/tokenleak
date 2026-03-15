import type {
  DailyUsage,
  ExplainAnomaly,
  ExplainEvidenceRow,
  ExplainReport,
  ModelBreakdown,
  ProjectDrilldownEntry,
  ProviderData,
  SessionDrilldownEntry,
  UsageEvent,
} from '../types';
import { ONE_DAY_MS, dateToUtcMs, formatDateStringUtc } from '../date-utils';
import { buildProjectRollups, buildSessionRollups } from './analytics';
import { cacheHitRate } from './cache-rate';
import { mergeProviderData } from './merge';

const PROVIDER_LIMIT = 5;
const SESSION_LIMIT = 5;
const PROJECT_LIMIT = 5;
const MODEL_LIMIT = 5;
const LOOKBACK_7D = 7;
const LOOKBACK_30D = 30;
const SPIKE_MULTIPLIER = 2;
const SPIKE_MIN_DELTA = 5_000;
const SPIKE_MIN_TOKENS = 7_500;
const CACHE_DROP_MIN_TOKENS = 5_000;
const CACHE_DROP_DELTA = 0.2;
const LONG_SESSION_MS = 3 * 60 * 60 * 1_000;
const DENSE_SESSION_TOKENS_PER_HOUR = 40_000;
const DENSE_SESSION_MIN_TOKENS = 3_000;

interface DailyTotals {
  tokens: number;
  cost: number;
  inputTokens: number;
  cacheReadTokens: number;
}

interface CandidateRow {
  label: string;
  tokens: number;
  cost: number;
}

function collectEvents(providers: ProviderData[]): UsageEvent[] {
  return providers.flatMap((provider) => provider.events ?? []);
}

function sortRows<T extends CandidateRow>(rows: T[]): T[] {
  return rows
    .slice()
    .sort((left, right) => right.tokens - left.tokens || left.label.localeCompare(right.label));
}

function toEvidenceRows(rows: CandidateRow[], totalTokens: number, limit: number): ExplainEvidenceRow[] {
  return sortRows(rows)
    .filter((row) => row.tokens > 0)
    .slice(0, limit)
    .map((row) => ({
      label: row.label,
      tokens: row.tokens,
      cost: row.cost,
      share: totalTokens > 0 ? row.tokens / totalTokens : 0,
    }));
}

function buildPreviousDates(targetDate: string, count: number): string[] {
  const startMs = dateToUtcMs(targetDate);
  const dates: string[] = [];

  for (let offset = count; offset >= 1; offset--) {
    dates.push(formatDateStringUtc(new Date(startMs - offset * ONE_DAY_MS)));
  }

  return dates;
}

function averageForDates(
  byDate: Map<string, number>,
  dates: string[],
): number {
  if (dates.length === 0) {
    return 0;
  }

  let total = 0;
  for (const date of dates) {
    total += byDate.get(date) ?? 0;
  }

  return total / dates.length;
}

function buildMergedDailyTotals(providers: ProviderData[]): Map<string, DailyTotals> {
  const merged = mergeProviderData(providers);
  const totals = new Map<string, DailyTotals>();

  for (const day of merged) {
    totals.set(day.date, {
      tokens: day.totalTokens,
      cost: day.cost,
      inputTokens: day.inputTokens,
      cacheReadTokens: day.cacheReadTokens,
    });
  }

  return totals;
}

function buildModelDailyMaps(providers: ProviderData[]): {
  tokenByModelAndDate: Map<string, Map<string, number>>;
  costByModelAndDate: Map<string, Map<string, number>>;
} {
  const tokenByModelAndDate = new Map<string, Map<string, number>>();
  const costByModelAndDate = new Map<string, Map<string, number>>();

  for (const provider of providers) {
    for (const day of provider.daily) {
      for (const model of day.models) {
        let tokenDates = tokenByModelAndDate.get(model.model);
        if (!tokenDates) {
          tokenDates = new Map<string, number>();
          tokenByModelAndDate.set(model.model, tokenDates);
        }
        tokenDates.set(day.date, (tokenDates.get(day.date) ?? 0) + model.totalTokens);

        let costDates = costByModelAndDate.get(model.model);
        if (!costDates) {
          costDates = new Map<string, number>();
          costByModelAndDate.set(model.model, costDates);
        }
        costDates.set(day.date, (costDates.get(day.date) ?? 0) + model.cost);
      }
    }
  }

  return { tokenByModelAndDate, costByModelAndDate };
}

function buildProviderEvidenceRows(providers: ProviderData[], targetDate: string, totalTokens: number): ExplainEvidenceRow[] {
  const rows = providers.map((provider) => {
    const day = provider.daily.find((entry) => entry.date === targetDate);
    return {
      label: provider.displayName,
      tokens: day?.totalTokens ?? 0,
      cost: day?.cost ?? 0,
    };
  });

  return toEvidenceRows(rows, totalTokens, PROVIDER_LIMIT);
}

function buildModelEvidenceRows(providers: ProviderData[], targetDate: string, totalTokens: number): ExplainEvidenceRow[] {
  const totals = new Map<string, CandidateRow>();

  for (const provider of providers) {
    const day = provider.daily.find((entry) => entry.date === targetDate);
    if (!day) {
      continue;
    }

    for (const model of day.models) {
      const existing = totals.get(model.model) ?? {
        label: model.model,
        tokens: 0,
        cost: 0,
      };
      existing.tokens += model.totalTokens;
      existing.cost += model.cost;
      totals.set(model.model, existing);
    }
  }

  return toEvidenceRows([...totals.values()], totalTokens, MODEL_LIMIT);
}

function buildSessionLabel(session: SessionDrilldownEntry): string {
  const suffix = session.directory && session.directory !== '.'
    ? session.directory
    : session.projectId ?? session.label ?? session.sessionId;
  return `${session.provider}:${suffix}`;
}

function buildProjectLabel(project: ProjectDrilldownEntry): string {
  if (project.directory && project.directory !== '.') {
    return project.directory;
  }

  return project.projectId;
}

function buildSessionEvidenceRows(events: UsageEvent[], totalTokens: number): ExplainEvidenceRow[] {
  const rows = buildSessionRollups(events).map((session) => ({
    label: buildSessionLabel(session),
    tokens: session.totalTokens,
    cost: session.cost,
  }));

  return toEvidenceRows(rows, totalTokens, SESSION_LIMIT);
}

function buildProjectEvidenceRows(events: UsageEvent[], totalTokens: number): ExplainEvidenceRow[] {
  const rows = buildProjectRollups(events).map((project) => ({
    label: buildProjectLabel(project),
    tokens: project.totalTokens,
    cost: project.cost,
  }));

  return toEvidenceRows(rows, totalTokens, PROJECT_LIMIT);
}

function isSpike(currentTokens: number, averageTokens: number): boolean {
  if (currentTokens < SPIKE_MIN_TOKENS) {
    return false;
  }

  if (averageTokens <= 0) {
    return currentTokens >= SPIKE_MIN_TOKENS;
  }

  return currentTokens >= averageTokens * SPIKE_MULTIPLIER && currentTokens - averageTokens >= SPIKE_MIN_DELTA;
}

function formatTokens(tokens: number): string {
  return Math.round(tokens).toLocaleString('en-US');
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return `${Math.round(tokens)}`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

function describeDelta(current: number, average: number): string {
  const delta = current - average;
  const sign = delta >= 0 ? '+' : '-';
  return `${sign}${formatCompactTokens(Math.abs(delta))}`;
}

function buildHeadline(
  targetDate: string,
  totalTokens: number,
  average7dTokens: number,
  average30dTokens: number,
  topProviders: ExplainEvidenceRow[],
): string {
  if (totalTokens === 0) {
    return `No recorded token activity on ${targetDate}`;
  }

  const leadProvider = topProviders[0];
  const providerSuffix = leadProvider && leadProvider.share >= 0.5 ? ` led by ${leadProvider.label}` : '';

  if (average30dTokens > 0 && totalTokens >= average30dTokens * 3) {
    return `Spike day on ${targetDate}${providerSuffix}`;
  }

  if (average7dTokens > 0 && totalTokens >= average7dTokens * 1.5) {
    return `Above-baseline activity on ${targetDate}${providerSuffix}`;
  }

  if (average7dTokens > 0 && totalTokens <= average7dTokens * 0.5) {
    return `Quiet day on ${targetDate}${providerSuffix}`;
  }

  return `Typical activity on ${targetDate}${providerSuffix}`;
}

function buildSummaryLines(input: {
  date: string;
  totalTokens: number;
  totalCost: number;
  average7dTokens: number;
  average30dTokens: number;
  average7dCost: number;
  average30dCost: number;
  topProviders: ExplainEvidenceRow[];
  topModels: ExplainEvidenceRow[];
  anomalies: ExplainAnomaly[];
  dayCacheHitRate: number;
  average7dCacheHitRate: number;
}): string[] {
  if (input.totalTokens === 0) {
    return [
      `No provider reported activity on ${input.date}.`,
      `Trailing averages were ${formatCompactTokens(input.average7dTokens)} tokens/day over 7d and ${formatCompactTokens(input.average30dTokens)} tokens/day over 30d.`,
      'No anomaly flags were raised.',
    ];
  }

  const first = `${formatCompactTokens(input.totalTokens)} tokens (${formatCost(input.totalCost)}) on ${input.date}, ${describeDelta(input.totalTokens, input.average7dTokens)} vs trailing 7d average and ${describeDelta(input.totalTokens, input.average30dTokens)} vs trailing 30d average.`;
  const provider = input.topProviders[0];
  const model = input.topModels[0];
  const second = provider && model
    ? `${provider.label} contributed ${formatPercent(provider.share)} of the day, and ${model.label} accounted for ${formatPercent(model.share)} of tokens.`
    : `Trailing cost baselines were ${formatCost(input.average7dCost)}/day over 7d and ${formatCost(input.average30dCost)}/day over 30d.`;
  const third = input.anomalies.length > 0
    ? `${input.anomalies.length} anomaly flag${input.anomalies.length === 1 ? '' : 's'} raised. Cache hit rate was ${formatPercent(input.dayCacheHitRate)} versus a 7d average of ${formatPercent(input.average7dCacheHitRate)}.`
    : `No anomaly flags were raised. Cache hit rate was ${formatPercent(input.dayCacheHitRate)} versus a 7d average of ${formatPercent(input.average7dCacheHitRate)}.`;

  return [first, second, third];
}

function buildProviderSpikeAnomaly(
  providers: ProviderData[],
  previous7Dates: string[],
  targetDate: string,
): ExplainAnomaly | null {
  const candidates = providers.map((provider) => {
    const byDate = new Map<string, number>();
    for (const day of provider.daily) {
      byDate.set(day.date, day.totalTokens);
    }

    const currentTokens = byDate.get(targetDate) ?? 0;
    const averageTokens = averageForDates(byDate, previous7Dates);

    return {
      provider,
      currentTokens,
      averageTokens,
    };
  });

  const winner = candidates
    .filter((entry) => isSpike(entry.currentTokens, entry.averageTokens))
    .sort((left, right) => right.currentTokens - left.currentTokens || left.provider.displayName.localeCompare(right.provider.displayName))[0];

  if (!winner) {
    return null;
  }

  return {
    type: 'provider-spike',
    title: `${winner.provider.displayName} surged`,
    detail: `${winner.provider.displayName} reached ${formatTokens(winner.currentTokens)} tokens on ${targetDate} versus a trailing 7d average of ${formatTokens(winner.averageTokens)}.`,
  };
}

function buildModelSpikeAnomaly(
  providers: ProviderData[],
  previous7Dates: string[],
  targetDate: string,
): ExplainAnomaly | null {
  const { tokenByModelAndDate } = buildModelDailyMaps(providers);
  const candidates = [...tokenByModelAndDate.entries()].map(([model, byDate]) => ({
    model,
    currentTokens: byDate.get(targetDate) ?? 0,
    averageTokens: averageForDates(byDate, previous7Dates),
  }));

  const winner = candidates
    .filter((entry) => isSpike(entry.currentTokens, entry.averageTokens))
    .sort((left, right) => right.currentTokens - left.currentTokens || left.model.localeCompare(right.model))[0];

  if (!winner) {
    return null;
  }

  return {
    type: 'model-spike',
    title: `${winner.model} spiked`,
    detail: `${winner.model} accounted for ${formatTokens(winner.currentTokens)} tokens on ${targetDate} versus a trailing 7d average of ${formatTokens(winner.averageTokens)}.`,
  };
}

function buildCacheDropAnomaly(
  mergedDailyTotals: Map<string, DailyTotals>,
  previous7Dates: string[],
  targetDate: string,
): ExplainAnomaly | null {
  const current = mergedDailyTotals.get(targetDate);
  if (!current || current.tokens < CACHE_DROP_MIN_TOKENS) {
    return null;
  }

  const currentRate = cacheHitRate([{
    date: targetDate,
    inputTokens: current.inputTokens,
    outputTokens: 0,
    cacheReadTokens: current.cacheReadTokens,
    cacheWriteTokens: 0,
    totalTokens: current.tokens,
    cost: current.cost,
    models: [],
  }]);

  const previousEntries: DailyUsage[] = previous7Dates.map((date) => {
    const totals = mergedDailyTotals.get(date);
    return {
      date,
      inputTokens: totals?.inputTokens ?? 0,
      outputTokens: 0,
      cacheReadTokens: totals?.cacheReadTokens ?? 0,
      cacheWriteTokens: 0,
      totalTokens: totals?.tokens ?? 0,
      cost: totals?.cost ?? 0,
      models: [],
    };
  });
  const averageRate = cacheHitRate(previousEntries);

  if (averageRate - currentRate < CACHE_DROP_DELTA) {
    return null;
  }

  return {
    type: 'cache-drop',
    title: 'Cache reuse dropped',
    detail: `Cache hit rate fell to ${formatPercent(currentRate)} on ${targetDate} from a trailing 7d average of ${formatPercent(averageRate)}.`,
  };
}

function buildLongSessionAnomaly(sessions: SessionDrilldownEntry[]): ExplainAnomaly | null {
  const session = sessions
    .filter((entry) => (entry.durationMs ?? 0) >= LONG_SESSION_MS)
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0) || right.totalTokens - left.totalTokens)[0];

  if (!session || session.durationMs === null) {
    return null;
  }

  const durationHours = (session.durationMs / 3_600_000).toFixed(1);
  return {
    type: 'long-session',
    title: 'A single session ran long',
    detail: `${buildSessionLabel(session)} lasted ${durationHours}h and used ${formatTokens(session.totalTokens)} tokens.`,
  };
}

function buildDenseSessionAnomaly(sessions: SessionDrilldownEntry[]): ExplainAnomaly | null {
  const candidates = sessions
    .filter((
      entry,
    ): entry is SessionDrilldownEntry & { durationMs: number } => (
      entry.durationMs !== null && entry.durationMs > 0 && entry.totalTokens >= DENSE_SESSION_MIN_TOKENS
    ))
    .map((entry) => ({
      session: entry,
      tokensPerHour: entry.totalTokens / (entry.durationMs / 3_600_000),
    }))
    .filter((entry) => entry.tokensPerHour >= DENSE_SESSION_TOKENS_PER_HOUR)
    .sort((left, right) => right.tokensPerHour - left.tokensPerHour || right.session.totalTokens - left.session.totalTokens)[0];

  if (!candidates) {
    return null;
  }

  return {
    type: 'dense-session',
    title: 'A session was unusually dense',
    detail: `${buildSessionLabel(candidates.session)} sustained ${formatCompactTokens(candidates.tokensPerHour)} tokens/hour across ${formatTokens(candidates.session.totalTokens)} tokens.`,
  };
}

function compactAnomalies(anomalies: Array<ExplainAnomaly | null>): ExplainAnomaly[] {
  return anomalies.filter((entry): entry is ExplainAnomaly => entry !== null);
}

export function buildExplainReport(providers: ProviderData[], targetDate: string): ExplainReport {
  const mergedDailyTotals = buildMergedDailyTotals(providers);
  const previous7Dates = buildPreviousDates(targetDate, LOOKBACK_7D);
  const previous30Dates = buildPreviousDates(targetDate, LOOKBACK_30D);
  const dayTotals = mergedDailyTotals.get(targetDate) ?? {
    tokens: 0,
    cost: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
  };
  const average7dTokens = averageForDates(
    new Map([...mergedDailyTotals.entries()].map(([date, totals]) => [date, totals.tokens] as const)),
    previous7Dates,
  );
  const average30dTokens = averageForDates(
    new Map([...mergedDailyTotals.entries()].map(([date, totals]) => [date, totals.tokens] as const)),
    previous30Dates,
  );
  const average7dCost = averageForDates(
    new Map([...mergedDailyTotals.entries()].map(([date, totals]) => [date, totals.cost] as const)),
    previous7Dates,
  );
  const average30dCost = averageForDates(
    new Map([...mergedDailyTotals.entries()].map(([date, totals]) => [date, totals.cost] as const)),
    previous30Dates,
  );
  const dayCacheHitRate = cacheHitRate([{
    date: targetDate,
    inputTokens: dayTotals.inputTokens,
    outputTokens: 0,
    cacheReadTokens: dayTotals.cacheReadTokens,
    cacheWriteTokens: 0,
    totalTokens: dayTotals.tokens,
    cost: dayTotals.cost,
    models: [],
  }]);
  const average7dCacheHitRate = cacheHitRate(previous7Dates.map((date) => {
    const totals = mergedDailyTotals.get(date);
    return {
      date,
      inputTokens: totals?.inputTokens ?? 0,
      outputTokens: 0,
      cacheReadTokens: totals?.cacheReadTokens ?? 0,
      cacheWriteTokens: 0,
      totalTokens: totals?.tokens ?? 0,
      cost: totals?.cost ?? 0,
      models: [],
    };
  }));

  const dayEvents = collectEvents(providers).filter((event) => event.date === targetDate);
  const sessionRollups = buildSessionRollups(dayEvents);
  const topProviders = buildProviderEvidenceRows(providers, targetDate, dayTotals.tokens);
  const topModels = buildModelEvidenceRows(providers, targetDate, dayTotals.tokens);
  const anomalies = compactAnomalies([
    buildProviderSpikeAnomaly(providers, previous7Dates, targetDate),
    buildModelSpikeAnomaly(providers, previous7Dates, targetDate),
    buildCacheDropAnomaly(mergedDailyTotals, previous7Dates, targetDate),
    buildLongSessionAnomaly(sessionRollups),
    buildDenseSessionAnomaly(sessionRollups),
  ]);

  return {
    date: targetDate,
    totalTokens: dayTotals.tokens,
    totalCost: dayTotals.cost,
    comparedTo7dAverage: dayTotals.tokens - average7dTokens,
    comparedTo30dAverage: dayTotals.tokens - average30dTokens,
    headline: buildHeadline(targetDate, dayTotals.tokens, average7dTokens, average30dTokens, topProviders),
    summary: buildSummaryLines({
      date: targetDate,
      totalTokens: dayTotals.tokens,
      totalCost: dayTotals.cost,
      average7dTokens,
      average30dTokens,
      average7dCost,
      average30dCost,
      topProviders,
      topModels,
      anomalies,
      dayCacheHitRate,
      average7dCacheHitRate,
    }),
    topProviders,
    topSessions: buildSessionEvidenceRows(dayEvents, dayTotals.tokens),
    topProjects: buildProjectEvidenceRows(dayEvents, dayTotals.tokens),
    topModels,
    anomalies,
  };
}
