import type {
  AgentBehaviorDiffReport,
  BehaviorCohortMetrics,
  BehaviorCohortSelector,
  DateRange,
  UsageEvent,
} from '../types';
import { buildSessionRollups } from './analytics';
import { buildAgentWasteReport } from './agent-waste';

const METHOD =
  'Agent behavior diff v1: deterministic cohort comparison across providers, models, projects, repos, date ranges, and task styles.';

function normalize(value: string | undefined): string {
  return (value ?? '').toLowerCase().trim();
}

function matchesSelector(event: UsageEvent, selector: BehaviorCohortSelector): boolean {
  switch (selector.dimension) {
    case 'provider':
      return normalize(event.provider) === normalize(selector.provider);
    case 'model':
      return normalize(event.model) === normalize(selector.model);
    case 'project':
      return normalize(event.projectId) === normalize(selector.projectId);
    case 'repo':
      return normalize(event.repoRoot) === normalize(selector.repoRoot);
    case 'date-range':
      return Boolean(selector.dateRange && event.date >= selector.dateRange.since && event.date <= selector.dateRange.until);
    case 'session-style': {
      const duration = event.durationMs ?? 0;
      if (selector.taskStyle === 'quick-hit') return duration <= 10 * 60 * 1_000 && event.totalTokens < 6_000;
      if (selector.taskStyle === 'deep-work') return duration >= 45 * 60 * 1_000 || event.totalTokens >= 20_000;
      if (selector.taskStyle === 'iterative') return duration >= 15 * 60 * 1_000 || event.totalTokens >= 6_000;
      return true;
    }
  }
}

function nullWhenMissing(value: number, hasDenominator: boolean): number | null {
  return hasDenominator ? value : null;
}

function modelSwitchesPerSession(events: UsageEvent[]): number {
  const bySession = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = event.sessionId ?? `${event.provider}:${event.date}`;
    const list = bySession.get(key) ?? [];
    list.push(event);
    bySession.set(key, list);
  }

  if (bySession.size === 0) return 0;
  let switches = 0;
  for (const sessionEvents of bySession.values()) {
    const ordered = sessionEvents.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i]!.model !== ordered[i - 1]!.model) switches++;
    }
  }
  return switches / bySession.size;
}

function metricsFor(events: UsageEvent[], dateRange: DateRange): BehaviorCohortMetrics {
  const sessions = buildSessionRollups(events);
  const waste = buildAgentWasteReport([], events, dateRange);
  const input = events.reduce((sum, event) => sum + event.inputTokens, 0);
  const output = events.reduce((sum, event) => sum + event.outputTokens, 0);
  const read = events.reduce((sum, event) => sum + event.cacheReadTokens, 0);
  const write = events.reduce((sum, event) => sum + event.cacheWriteTokens, 0);
  const tokens = events.reduce((sum, event) => sum + event.totalTokens, 0);
  const cost = events.reduce((sum, event) => sum + event.cost, 0);
  const activeDays = new Set(events.map((event) => event.date)).size;
  const durationSessions = sessions.filter((session) => session.durationMs !== null);
  const estimatedSavings = waste.signals
    .map((signal) => signal.estimatedSavings)
    .filter((value): value is number => value !== null);

  return {
    events: events.length,
    sessions: sessions.length,
    activeDays,
    tokens,
    cost,
    inputPerOutput: output > 0 ? input / output : null,
    outputPerDollar: cost > 0 ? output / cost : null,
    cacheHitRate: input + read > 0 ? read / (input + read) : 0,
    cacheReuseRatio: write > 0 ? read / write : null,
    modelSwitchesPerSession: modelSwitchesPerSession(events),
    wasteSignals: waste.signals.length,
    highSeverityWasteSignals: waste.summary.highSeverity,
    estimatedWasteSavings: estimatedSavings.length > 0 ? estimatedSavings.reduce((sum, value) => sum + value, 0) : null,
    averageSessionDurationMs: durationSessions.length > 0
      ? durationSessions.reduce((sum, session) => sum + (session.durationMs ?? 0), 0) / durationSessions.length
      : null,
  };
}

function deltaValue(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return b - a;
}

function buildDeltas(
  baseline: BehaviorCohortMetrics,
  comparison: BehaviorCohortMetrics,
): Record<keyof BehaviorCohortMetrics, number | null> {
  if (baseline.events === 0 || comparison.events === 0) {
    return {
      events: null,
      sessions: null,
      activeDays: null,
      tokens: null,
      cost: null,
      inputPerOutput: null,
      outputPerDollar: null,
      cacheHitRate: null,
      cacheReuseRatio: null,
      modelSwitchesPerSession: null,
      wasteSignals: null,
      highSeverityWasteSignals: null,
      estimatedWasteSavings: null,
      averageSessionDurationMs: null,
    };
  }

  return {
    events: deltaValue(baseline.events, comparison.events),
    sessions: deltaValue(baseline.sessions, comparison.sessions),
    activeDays: deltaValue(baseline.activeDays, comparison.activeDays),
    tokens: deltaValue(baseline.tokens, comparison.tokens),
    cost: deltaValue(baseline.cost, comparison.cost),
    inputPerOutput: deltaValue(baseline.inputPerOutput, comparison.inputPerOutput),
    outputPerDollar: deltaValue(baseline.outputPerDollar, comparison.outputPerDollar),
    cacheHitRate: deltaValue(baseline.cacheHitRate, comparison.cacheHitRate),
    cacheReuseRatio: deltaValue(baseline.cacheReuseRatio, comparison.cacheReuseRatio),
    modelSwitchesPerSession: deltaValue(baseline.modelSwitchesPerSession, comparison.modelSwitchesPerSession),
    wasteSignals: deltaValue(baseline.wasteSignals, comparison.wasteSignals),
    highSeverityWasteSignals: deltaValue(baseline.highSeverityWasteSignals, comparison.highSeverityWasteSignals),
    estimatedWasteSavings: deltaValue(baseline.estimatedWasteSavings, comparison.estimatedWasteSavings),
    averageSessionDurationMs: deltaValue(baseline.averageSessionDurationMs, comparison.averageSessionDurationMs),
  };
}

function percentChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return (to - from) / from;
}

function formatPercent(value: number): string {
  return `${Math.abs(value * 100).toFixed(0)}%`;
}

function buildTakeaways(
  baseline: BehaviorCohortSelector,
  comparison: BehaviorCohortSelector,
  baselineMetrics: BehaviorCohortMetrics,
  comparisonMetrics: BehaviorCohortMetrics,
): string[] {
  const takeaways: string[] = [];
  const inputChange = percentChange(baselineMetrics.inputPerOutput, comparisonMetrics.inputPerOutput);
  if (inputChange !== null && Math.abs(inputChange) >= 0.05) {
    takeaways.push(
      `${comparison.label} used ${formatPercent(inputChange)} ${inputChange < 0 ? 'fewer' : 'more'} input tokens per output token than ${baseline.label}.`,
    );
  }

  const costChange = percentChange(baselineMetrics.cost, comparisonMetrics.cost);
  if (costChange !== null && Math.abs(costChange) >= 0.05) {
    takeaways.push(
      `${comparison.label} cost ${formatPercent(costChange)} ${costChange < 0 ? 'less' : 'more'} than ${baseline.label}.`,
    );
  }

  const cacheDelta = comparisonMetrics.cacheHitRate - baselineMetrics.cacheHitRate;
  if (Math.abs(cacheDelta) >= 0.05) {
    takeaways.push(
      `${comparison.label} had ${(Math.abs(cacheDelta) * 100).toFixed(0)} points ${cacheDelta > 0 ? 'higher' : 'lower'} cache hit rate.`,
    );
  }

  const wasteDelta = comparisonMetrics.wasteSignals - baselineMetrics.wasteSignals;
  if (wasteDelta !== 0) {
    takeaways.push(
      `${comparison.label} produced ${Math.abs(wasteDelta)} ${wasteDelta > 0 ? 'more' : 'fewer'} waste signals.`,
    );
  }

  if (takeaways.length === 0) {
    takeaways.push(`${comparison.label} and ${baseline.label} look similar on the selected metrics.`);
  }
  return takeaways;
}

function selectorsIdentical(a: BehaviorCohortSelector, b: BehaviorCohortSelector): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function addWarnings(
  warnings: string[],
  label: string,
  metrics: BehaviorCohortMetrics,
  role: 'Baseline' | 'Comparison',
): void {
  if (metrics.events === 0) warnings.push(`${role} cohort is empty: ${label}.`);
  if (metrics.sessions < 5 || metrics.events < 10) warnings.push(`${role} cohort is sparse: ${label}.`);
  if (metrics.cost === 0) warnings.push(`${role} cohort has no cost data: ${label}.`);
}

export function buildAgentBehaviorDiffReport(
  events: UsageEvent[],
  dateRange: DateRange,
  baselineSelector: BehaviorCohortSelector,
  comparisonSelector: BehaviorCohortSelector,
): AgentBehaviorDiffReport {
  const warnings: string[] = [];
  if (selectorsIdentical(baselineSelector, comparisonSelector)) {
    warnings.push('Baseline and comparison selectors are identical.');
  }

  const baselineEvents = events.filter((event) => matchesSelector(event, baselineSelector));
  const comparisonEvents = events.filter((event) => matchesSelector(event, comparisonSelector));
  const baselineMetrics = metricsFor(baselineEvents, baselineSelector.dateRange ?? dateRange);
  const comparisonMetrics = metricsFor(comparisonEvents, comparisonSelector.dateRange ?? dateRange);

  addWarnings(warnings, baselineSelector.label, baselineMetrics, 'Baseline');
  addWarnings(warnings, comparisonSelector.label, comparisonMetrics, 'Comparison');

  return {
    method: METHOD,
    dateRange,
    baseline: { selector: baselineSelector, metrics: baselineMetrics },
    comparison: { selector: comparisonSelector, metrics: comparisonMetrics },
    deltas: buildDeltas(baselineMetrics, comparisonMetrics),
    takeaways: buildTakeaways(baselineSelector, comparisonSelector, baselineMetrics, comparisonMetrics),
    warnings: [...new Set(warnings)],
  };
}
