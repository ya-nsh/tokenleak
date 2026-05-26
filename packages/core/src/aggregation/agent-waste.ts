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
import { buildSessionRollups } from './analytics';
import { clusterPrompts } from './prompt-clusters';

const METHOD =
  'Agent waste detector v1: deterministic signals from local events, prompts, cache, model churn, and session rollups.';
const CONTEXT_DRAG_INPUT_PER_OUTPUT = 8;
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
    const key = event.sessionId?.trim() || `${event.provider}:${event.date}`;
    const list = sessions.get(key) ?? [];
    list.push(event);
    sessions.set(key, list);
  }
  return sessions;
}

function detectContextDrag(events: UsageEvent[]): AgentWasteSignal[] {
  const signals: AgentWasteSignal[] = [];
  for (const sessionEvents of bySession(events).values()) {
    const input = sessionEvents.reduce((sum, event) => sum + event.inputTokens, 0);
    const output = sessionEvents.reduce((sum, event) => sum + event.outputTokens, 0);
    if (output <= 0 || input / output < CONTEXT_DRAG_INPUT_PER_OUTPUT) {
      continue;
    }
    const evidence = evidenceFromEvents(
      sessionEvents,
      `Input tokens are ${(input / output).toFixed(1)}x output tokens in this session.`,
    );
    signals.push({
      kind: 'context-drag',
      title: 'High context drag',
      severity: severityFor(evidence.cost, 'medium'),
      confidence: confidenceFor(sessionEvents.length, !sessionEvents[0]?.sessionId),
      estimatedSavings: estimatedSavings(evidence.cost, 0.2),
      evidence,
      recipes: [
        recipe('Start a compact follow-up session', 'Ask for a concise handoff, then continue with only the files and context needed for the next step.'),
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
    const hitRate = input + read > 0 ? read / (input + read) : 0;
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

function detectLongLowYield(events: UsageEvent[]): AgentWasteSignal[] {
  return buildSessionRollups(events)
    .filter((session) => (
      (session.durationMs ?? 0) >= 45 * 60 * 1_000 &&
      session.cost > 0 &&
      session.outputTokens / session.cost < 2_000
    ))
    .slice(0, 5)
    .map((session): AgentWasteSignal => ({
      kind: 'long-session-low-yield',
      title: 'Long session with low output per dollar',
      severity: severityFor(session.cost, 'low'),
      confidence: confidenceFor(session.eventCount),
      estimatedSavings: estimatedSavings(session.cost, 0.2),
      evidence: {
        provider: session.provider,
        projectId: session.projectId,
        repoRoot: session.repoRoot,
        sessionId: session.sessionId,
        eventCount: session.eventCount,
        tokens: session.totalTokens,
        cost: session.cost,
        reason: `Session ran ${Math.round((session.durationMs ?? 0) / 60_000)} minutes with low output per dollar.`,
      },
      recipes: [
        recipe('Inspect the replay', 'Review the session timeline for broad reads, stalled loops, or repeated commands.', `tokenleak replay ${session.start.slice(0, 10)}`),
      ],
    }));
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

export function buildAgentWasteReport(
  providers: ProviderData[],
  events: UsageEvent[],
  dateRange: DateRange,
): AgentWasteReport {
  const warnings: string[] = [];
  const signals = sortSignals([
    ...detectContextDrag(events),
    ...detectPromptRepeats(events, warnings),
    ...detectModelChurn(events),
    ...detectPremiumSmallTask(events),
    ...detectCacheWaste(providers),
    ...detectLongLowYield(events),
  ]);
  const estimated = signals
    .map((signal) => signal.estimatedSavings)
    .filter((value): value is number => value !== null);
  const sessions = new Set(events.map((event) => event.sessionId ?? `${event.provider}:${event.date}`));

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
