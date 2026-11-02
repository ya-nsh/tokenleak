import { sessionKey } from './session-identity';
import type {
  AgentWasteReport,
  AgentWasteSignal,
  DateRange,
  OptimizationConfidence,
  OptimizationEvidence,
  ProviderData,
  UsageEvent,
  WasteRecipe,
} from '../types';
import { formatTokenCount, formatUsd } from '../format';
import { activeDurationMs } from './focus';
import { buildSessionRollups, describeProject } from './analytics';
import { clusterPrompts } from './prompt-clusters';

const METHOD =
  'Agent waste detector v1: deterministic signals from local events, prompts, cache, model churn, and session rollups.';
/** Sessions shorter than this are too brief for context growth to matter. */
const CONTEXT_DRAG_MIN_TURNS = 20;
/** Late-session requests carrying at least this much context are heavy. */
const CONTEXT_DRAG_LATE_TOKENS = 150_000;
/** ...and only count as drag when they grew this much from the start. */
const CONTEXT_DRAG_GROWTH = 2;
/** Share of the extra context a compaction or fresh session would remove. */
const CONTEXT_DRAG_SAVINGS_FRACTION = 0.5;
const TOKENS_PER_MILLION = 1_000_000;
/** Session-level kinds list this many sessions; the rest roll into one signal. */
const MAX_SIGNALS_PER_SESSION_KIND = 10;
const SESSION_LEVEL_KINDS: ReadonlySet<AgentWasteSignal['kind']> = new Set(['context-drag', 'long-session-low-yield', 'model-churn']);
const CACHE_HIT_LOW = 0.25;
const CACHE_REUSE_LOW = 2;
const MODEL_CHURN_SWITCHES = 3;
const PROMPT_REPEAT_COUNT = 3;
const PREMIUM_SMALL_OUTPUT = 1_000;
const PREMIUM_SMALL_TOKENS = 10_000;

function severityFor(cost: number, fallback: AgentWasteSignal['severity'] = 'low'): AgentWasteSignal['severity'] {
  if (cost >= 10) return 'high';
  if (cost >= 2) return 'medium';
  return fallback;
}

function confidenceFor(count: number, degraded = false): OptimizationConfidence {
  if (degraded || count < 3) return 'low';
  if (count < 6) return 'medium';
  return 'high';
}

function recipe(title: string, detail: string, command?: string): WasteRecipe {
  return { title, detail, command };
}

function evidenceFromEvents(events: UsageEvent[], reason: string): OptimizationEvidence {
  const first = events[0];
  return {
    provider: first?.provider,
    model: first?.model,
    projectId: first?.projectId ?? null,
    repoRoot: first?.repoRoot ?? null,
    sessionId: first?.sessionId ?? null,
    date: first?.date,
    eventCount: events.length,
    tokens: events.reduce((sum, event) => sum + event.totalTokens, 0),
    cost: events.reduce((sum, event) => sum + event.cost, 0),
    reason,
  };
}

function estimatedSavings(cost: number, fraction: number): number | null {
  return cost > 0 ? cost * fraction : null;
}

function bySession(events: UsageEvent[]): Map<string, UsageEvent[]> {
  const sessions = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = sessionKey(event.provider, event.sessionId?.trim() || event.date);
    const list = sessions.get(key) ?? [];
    list.push(event);
    sessions.set(key, list);
  }
  return sessions;
}

function requestContext(event: UsageEvent): number {
  return event.inputTokens + event.cacheReadTokens + event.cacheWriteTokens;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/**
 * Context drag: a long session whose requests keep re-sending a growing
 * context. Every agentic turn re-reads the conversation, so a high
 * input/output ratio alone is normal; what is avoidable is late turns
 * carrying far more context than early ones did.
 */
function detectContextDrag(events: UsageEvent[]): AgentWasteSignal[] {
  const signals: AgentWasteSignal[] = [];
  for (const sessionEvents of bySession(events).values()) {
    if (sessionEvents.length < CONTEXT_DRAG_MIN_TURNS) continue;
    const ordered = sessionEvents.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const contexts = ordered.map(requestContext);
    const quarter = Math.floor(contexts.length / 4);
    const early = median(contexts.slice(0, quarter));
    const late = median(contexts.slice(contexts.length - quarter));
    if (early <= 0 || late < CONTEXT_DRAG_LATE_TOKENS || late / early < CONTEXT_DRAG_GROWTH) continue;

    // Price the context carried beyond the early baseline at each turn's cache-read rate.
    let excessCost = 0;
    for (const event of ordered) {
      const excess = Math.max(0, requestContext(event) - early);
      excessCost += (excess / TOKENS_PER_MILLION) * (event.pricing?.cacheRead ?? 0);
    }
    const savings = estimatedSavings(excessCost, CONTEXT_DRAG_SAVINGS_FRACTION);
    const first = ordered[0]!;
    const label = describeProject(first.projectId, first.repoRoot) ?? first.sessionId ?? 'this session';
    const evidence = evidenceFromEvents(
      ordered,
      `${label}: requests grew from ${formatTokenCount(early)} to ${formatTokenCount(late)} tokens of context over ${ordered.length} turns.`,
    );
    signals.push({
      kind: 'context-drag',
      title: 'Context keeps growing',
      severity: severityFor(savings ?? 0, 'low'),
      confidence: confidenceFor(ordered.length, !first.sessionId),
      estimatedSavings: savings,
      evidence,
      recipes: [
        recipe(
          'Compact or hand off before context balloons',
          'When a task changes, ask for a short handoff and continue in a fresh session (or /compact) with only the files the next step needs.',
        ),
      ],
    });
  }
  return signals;
}

function detectPromptRepeats(events: UsageEvent[], warnings: string[]): AgentWasteSignal[] {
  const prompted = events.filter((event) => event.prompt?.trim());
  if (prompted.length === 0) {
    warnings.push('No prompt text captured; skipped retry-loop and prompt-repeat signals.');
    return [];
  }

  return clusterPrompts(prompted)
    .filter((cluster) => cluster.count >= PROMPT_REPEAT_COUNT)
    .slice(0, 5)
    .map((cluster): AgentWasteSignal => ({
      kind: 'prompt-repeat',
      title: 'Repeated prompt cluster',
      severity: severityFor(cluster.totalCost, 'low'),
      confidence: confidenceFor(cluster.count),
      estimatedSavings: estimatedSavings(cluster.totalCost, 0.3),
      evidence: {
        eventCount: cluster.count,
        tokens: cluster.totalTokens,
        cost: cluster.totalCost,
        reason: `${cluster.count} similar prompts clustered around "${cluster.canonicalPrompt}".`,
      },
      recipes: [
        recipe('Break the retry loop', 'Summarize what failed, state the next hypothesis, and ask for one targeted change instead of repeating the same request.'),
      ],
    }));
}

function detectModelChurn(events: UsageEvent[]): AgentWasteSignal[] {
  const signals: AgentWasteSignal[] = [];
  for (const sessionEvents of bySession(events).values()) {
    const ordered = sessionEvents.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let switches = 0;
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i]!.model !== ordered[i - 1]!.model) switches++;
    }
    if (switches < MODEL_CHURN_SWITCHES || new Set(ordered.map((event) => event.model)).size <= 1) {
      continue;
    }
    const evidence = evidenceFromEvents(ordered, `Session switched models ${switches} times across ${ordered.length} events.`);
    signals.push({
      kind: 'model-churn',
      title: 'Frequent model switching',
      severity: 'low',
      confidence: confidenceFor(ordered.length),
      estimatedSavings: estimatedSavings(evidence.cost, 0.1),
      evidence,
      recipes: [
        recipe('Choose model roles up front', 'Use one model for exploration and one for edits instead of switching repeatedly inside the same task.'),
      ],
    });
  }
  return signals;
}

function detectPremiumSmallTask(events: UsageEvent[]): AgentWasteSignal[] {
  return events
    .filter((event) => (
      /opus|gpt-4o|gpt-5\.5|gpt-5\.4/.test(event.model.toLowerCase()) &&
      event.outputTokens <= PREMIUM_SMALL_OUTPUT &&
      event.totalTokens <= PREMIUM_SMALL_TOKENS
    ))
    .slice(0, 5)
    .map((event): AgentWasteSignal => ({
      kind: 'premium-for-small-task',
      title: 'Premium model used for a small task',
      severity: severityFor(event.cost, 'low'),
      confidence: confidenceFor(1, true),
      estimatedSavings: estimatedSavings(event.cost, 0.35),
      evidence: evidenceFromEvents([event], `${event.model} produced ${event.outputTokens.toLocaleString('en-US')} output tokens.`),
      recipes: [
        recipe('Route small asks down', 'Use routing simulation to estimate savings from sending short lookups and tiny fixes to a cheaper model.', 'tokenleak simulate-routing --days 30'),
      ],
    }));
}

function detectCacheWaste(providers: ProviderData[]): AgentWasteSignal[] {
  const signals: AgentWasteSignal[] = [];
  for (const provider of providers) {
    const input = provider.daily.reduce((sum, day) => sum + day.inputTokens, 0);
    const read = provider.daily.reduce((sum, day) => sum + day.cacheReadTokens, 0);
    const write = provider.daily.reduce((sum, day) => sum + day.cacheWriteTokens, 0);
    if (read === 0 && write === 0) {
      continue;
    }
    const hitRate = input + read + write > 0 ? read / (input + read + write) : 0;
    if (hitRate < CACHE_HIT_LOW) {
      signals.push({
        kind: 'cache-miss-heavy',
        title: 'Low cache hit rate',
        severity: provider.totalCost >= 10 ? 'medium' : 'low',
        confidence: 'medium',
        estimatedSavings: estimatedSavings(provider.totalCost, 0.15),
        evidence: {
          provider: provider.provider,
          eventCount: provider.events?.length ?? 0,
          tokens: provider.totalTokens,
          cost: provider.totalCost,
          reason: `Cache hit rate is ${(hitRate * 100).toFixed(0)}% for ${provider.displayName}.`,
        },
        recipes: [
          recipe('Stabilize reusable context', 'Move stable instructions into project guidance and avoid resending large changing context blocks.'),
        ],
      });
    }
    const reuseRatio = write > 0 ? read / write : null;
    if (reuseRatio !== null && reuseRatio < CACHE_REUSE_LOW) {
      signals.push({
        kind: 'cache-write-waste',
        title: 'Cache writes are not paying back',
        severity: write > 100_000 ? 'medium' : 'low',
        confidence: 'medium',
        estimatedSavings: null,
        evidence: {
          provider: provider.provider,
          eventCount: provider.events?.length ?? 0,
          tokens: write,
          cost: provider.totalCost,
          reason: `Cache reuse ratio is ${reuseRatio.toFixed(1)}x from ${write.toLocaleString('en-US')} write tokens.`,
        },
        recipes: [
          recipe('Batch related work', 'Keep stable instructions unchanged and group related tasks so cache writes are reused.'),
        ],
      });
    }
  }
  return signals;
}

/** Sessions with at least this much active time count as long. */
const LONG_SESSION_ACTIVE_MS = 45 * 60_000;
/** Below this many output tokens per dollar, a session produced little for its spend. */
const LOW_YIELD_OUTPUT_PER_DOLLAR = 2_000;
const LOW_YIELD_SAVINGS_FRACTION = 0.2;

function detectLongLowYield(events: UsageEvent[]): AgentWasteSignal[] {
  const timestamps = new Map<string, string[]>();
  for (const event of events) {
    if (!event.sessionId?.trim()) continue;
    const key = sessionKey(event.provider, event.sessionId.trim());
    const list = timestamps.get(key) ?? [];
    list.push(event.timestamp);
    timestamps.set(key, list);
  }
  return buildSessionRollups(events).flatMap((session): AgentWasteSignal[] => {
    // Active time, not wall-clock span: a session resumed over two days is not "long".
    const activeMs = activeDurationMs(timestamps.get(sessionKey(session.provider, session.sessionId)) ?? []);
    if (
      activeMs < LONG_SESSION_ACTIVE_MS ||
      session.cost <= 0 ||
      session.outputTokens / session.cost >= LOW_YIELD_OUTPUT_PER_DOLLAR
    ) {
      return [];
    }
    const label = describeProject(session.projectId, session.repoRoot) ?? session.sessionId;
    return [{
      kind: 'long-session-low-yield',
      title: 'Long session with low output per dollar',
      severity: severityFor(session.cost, 'low'),
      confidence: confidenceFor(session.eventCount),
      estimatedSavings: estimatedSavings(session.cost, LOW_YIELD_SAVINGS_FRACTION),
      evidence: {
        provider: session.provider,
        projectId: session.projectId,
        repoRoot: session.repoRoot,
        sessionId: session.sessionId,
        eventCount: session.eventCount,
        tokens: session.totalTokens,
        cost: session.cost,
        reason: `${label}: ${Math.round(activeMs / 60_000)} active minutes produced ${formatTokenCount(session.outputTokens)} output tokens for ${formatUsd(session.cost)}.`,
      },
      recipes: [
        recipe('Inspect the replay', 'Review the session timeline for broad reads, stalled loops, or repeated commands.', `tokenleak replay ${session.start.slice(0, 10)}`),
      ],
    }];
  });
}

function sortSignals(signals: AgentWasteSignal[]): AgentWasteSignal[] {
  const severityRank = { high: 3, medium: 2, low: 1 };
  return signals.sort((a, b) => (
    severityRank[b.severity] - severityRank[a.severity] ||
    (b.estimatedSavings ?? 0) - (a.estimatedSavings ?? 0) ||
    b.evidence.tokens - a.evidence.tokens ||
    a.title.localeCompare(b.title)
  ));
}

/**
 * Keep the costliest sessions of each session-level kind and fold the rest
 * into a single "N more sessions" signal, so the report stays readable
 * without losing the total savings estimate.
 */
function capSessionSignals(signals: AgentWasteSignal[]): AgentWasteSignal[] {
  const kept: AgentWasteSignal[] = [];
  const byKind = new Map<AgentWasteSignal['kind'], AgentWasteSignal[]>();
  for (const signal of signals) {
    if (!SESSION_LEVEL_KINDS.has(signal.kind)) {
      kept.push(signal);
      continue;
    }
    const list = byKind.get(signal.kind) ?? [];
    list.push(signal);
    byKind.set(signal.kind, list);
  }
  for (const list of byKind.values()) {
    const ranked = list
      .slice()
      .sort((a, b) => (b.estimatedSavings ?? 0) - (a.estimatedSavings ?? 0) || b.evidence.cost - a.evidence.cost);
    kept.push(...ranked.slice(0, MAX_SIGNALS_PER_SESSION_KIND));
    const rest = ranked.slice(MAX_SIGNALS_PER_SESSION_KIND);
    if (rest.length === 0) continue;
    const savings = rest.reduce((sum, signal) => sum + (signal.estimatedSavings ?? 0), 0);
    const template = rest[0]!;
    kept.push({
      ...template,
      title: `${template.title} (${rest.length} more sessions)`,
      severity: severityFor(savings, 'low'),
      estimatedSavings: savings > 0 ? savings : null,
      evidence: {
        eventCount: rest.reduce((sum, signal) => sum + signal.evidence.eventCount, 0),
        tokens: rest.reduce((sum, signal) => sum + signal.evidence.tokens, 0),
        cost: rest.reduce((sum, signal) => sum + signal.evidence.cost, 0),
        reason: `${rest.length} more sessions show the same pattern with smaller estimated savings.`,
      },
    });
  }
  return kept;
}

export function buildAgentWasteReport(
  providers: ProviderData[],
  events: UsageEvent[],
  dateRange: DateRange,
): AgentWasteReport {
  const warnings: string[] = [];
  const signals = sortSignals(capSessionSignals([
    ...detectContextDrag(events),
    ...detectPromptRepeats(events, warnings),
    ...detectModelChurn(events),
    ...detectPremiumSmallTask(events),
    ...detectCacheWaste(providers),
    ...detectLongLowYield(events),
  ]));
  const estimated = signals
    .map((signal) => signal.estimatedSavings)
    .filter((value): value is number => value !== null);
  const sessions = new Set(events.map((event) => sessionKey(event.provider, event.sessionId ?? event.date)));

  return {
    method: METHOD,
    dateRange,
    summary: {
      totalSignals: signals.length,
      highSeverity: signals.filter((signal) => signal.severity === 'high').length,
      estimatedSavings: estimated.length > 0 ? estimated.reduce((sum, value) => sum + value, 0) : null,
      analyzedEvents: events.length,
      analyzedSessions: sessions.size,
    },
    signals,
    warnings: [...new Set(warnings)],
  };
}
