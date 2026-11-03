import type { SavingsKind, UsageEvent } from '../types';
import { formatTokenCount, formatUsd } from '../format';
import { activeDurationMs } from '../aggregation/focus';
import { buildSessionRollups, describeProject } from '../aggregation/analytics';
import { clusterPrompts } from '../aggregation/prompt-clusters';
import { sessionKey } from '../aggregation/session-identity';
import {
  TOKENS_PER_MILLION,
  confidenceFor,
  evidenceFromEvents,
  fractionOf,
  recipe,
  severityFor,
  type Finding,
} from './shared';

/** Sessions shorter than this are too brief for context growth to matter. */
const CONTEXT_DRAG_MIN_TURNS = 20;
/** Late-session requests carrying at least this much context are heavy. */
const CONTEXT_DRAG_LATE_TOKENS = 150_000;
/** ...and only count as drag when they grew this much from the start. */
const CONTEXT_DRAG_GROWTH = 2;
/** Share of the extra context a compaction or fresh session would remove. */
const CONTEXT_DRAG_SAVINGS_FRACTION = 0.5;
/** Quoted prompts in evidence are cut to one line of this many characters. */
const MAX_QUOTED_PROMPT_CHARS = 80;
/** Prompts clustered at least this many times count as a retry loop. */
const PROMPT_REPEAT_COUNT = 3;
const MAX_PROMPT_REPEAT_CLUSTERS = 5;
/** Share of a repeated cluster's cost a targeted retry would avoid. */
const PROMPT_REPEAT_SAVINGS_FRACTION = 0.3;
const MODEL_CHURN_SWITCHES = 3;
const MODEL_CHURN_SAVINGS_FRACTION = 0.1;
/** Sessions with at least this much active time count as long. */
const LONG_SESSION_ACTIVE_MS = 45 * 60_000;
/** Below this many output tokens per dollar, a session produced little for its spend. */
const LOW_YIELD_OUTPUT_PER_DOLLAR = 2_000;
const LOW_YIELD_SAVINGS_FRACTION = 0.2;
/** Session-level kinds list this many sessions; the rest roll into one finding. */
const MAX_FINDINGS_PER_SESSION_KIND = 10;
const SESSION_LEVEL_KINDS: ReadonlySet<SavingsKind> = new Set([
  'context-drag',
  'long-session-low-yield',
  'model-churn',
]);

/** Events grouped by session; events without a session id group by provider and day. */
export function groupBySession(events: readonly UsageEvent[]): Map<string, UsageEvent[]> {
  const sessions = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = sessionKey(event.provider, event.sessionId?.trim() || event.date);
    const list = sessions.get(key) ?? [];
    list.push(event);
    sessions.set(key, list);
  }
  return sessions;
}

/** A prompt as one short line for evidence text; pasted prompts can run to pages. */
function quotePrompt(prompt: string): string {
  const line = prompt.replace(/\s+/g, ' ').trim();
  return line.length <= MAX_QUOTED_PROMPT_CHARS
    ? line
    : `${line.slice(0, MAX_QUOTED_PROMPT_CHARS - 1)}\u2026`;
}

function chronological(events: readonly UsageEvent[]): UsageEvent[] {
  return events.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
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
function detectContextDrag(sessions: Iterable<UsageEvent[]>): Finding[] {
  const findings: Finding[] = [];
  for (const sessionEvents of sessions) {
    if (sessionEvents.length < CONTEXT_DRAG_MIN_TURNS) continue;
    const ordered = chronological(sessionEvents);
    const contexts = ordered.map(requestContext);
    const quarter = Math.floor(contexts.length / 4);
    const early = median(contexts.slice(0, quarter));
    const late = median(contexts.slice(contexts.length - quarter));
    if (early <= 0 || late < CONTEXT_DRAG_LATE_TOKENS || late / early < CONTEXT_DRAG_GROWTH)
      continue;

    // Price the context carried beyond the early baseline at each turn's cache-read rate.
    let excessCost = 0;
    for (const event of ordered) {
      const excess = Math.max(0, requestContext(event) - early);
      excessCost += (excess / TOKENS_PER_MILLION) * (event.pricing?.cacheRead ?? 0);
    }
    const savings = fractionOf(excessCost, CONTEXT_DRAG_SAVINGS_FRACTION);
    const first = ordered[0]!;
    const label =
      describeProject(first.projectId, first.repoRoot) ?? first.sessionId ?? 'this session';
    findings.push({
      kind: 'context-drag',
      title: 'Context keeps growing',
      severity: severityFor(savings ?? 0),
      confidence: confidenceFor(ordered.length, !first.sessionId),
      estimatedSavings: savings,
      evidence: evidenceFromEvents(
        ordered,
        `${label}: requests grew from ${formatTokenCount(early)} to ${formatTokenCount(late)} tokens of context over ${ordered.length} turns.`,
      ),
      recipes: [
        recipe(
          'Compact or hand off before context balloons',
          'When a task changes, ask for a short handoff and continue in a fresh session (or /compact) with only the files the next step needs.',
        ),
      ],
    });
  }
  return findings;
}

function detectPromptRepeats(events: readonly UsageEvent[], warnings: string[]): Finding[] {
  const prompted = events.filter((event) => event.prompt?.trim());
  if (prompted.length === 0) {
    warnings.push('No prompt text captured; skipped retry-loop and prompt-repeat signals.');
    return [];
  }

  return clusterPrompts(prompted)
    .filter((cluster) => cluster.count >= PROMPT_REPEAT_COUNT)
    .slice(0, MAX_PROMPT_REPEAT_CLUSTERS)
    .map(
      (cluster): Finding => ({
        kind: 'prompt-repeat',
        title: 'Repeated prompt cluster',
        severity: severityFor(cluster.totalCost),
        confidence: confidenceFor(cluster.count),
        estimatedSavings: fractionOf(cluster.totalCost, PROMPT_REPEAT_SAVINGS_FRACTION),
        evidence: {
          eventCount: cluster.count,
          tokens: cluster.totalTokens,
          cost: cluster.totalCost,
          reason: `${cluster.count} similar prompts clustered around "${quotePrompt(cluster.canonicalPrompt)}".`,
        },
        recipes: [
          recipe(
            'Break the retry loop',
            'Summarize what failed, state the next hypothesis, and ask for one targeted change instead of repeating the same request.',
          ),
        ],
      }),
    );
}

function detectModelChurn(sessions: Iterable<UsageEvent[]>): Finding[] {
  const findings: Finding[] = [];
  for (const sessionEvents of sessions) {
    const ordered = chronological(sessionEvents);
    let switches = 0;
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i]!.model !== ordered[i - 1]!.model) switches++;
    }
    if (switches < MODEL_CHURN_SWITCHES || new Set(ordered.map((event) => event.model)).size <= 1) {
      continue;
    }
    const evidence = evidenceFromEvents(
      ordered,
      `Session switched models ${switches} times across ${ordered.length} events.`,
    );
    findings.push({
      kind: 'model-churn',
      title: 'Frequent model switching',
      severity: 'low',
      confidence: confidenceFor(ordered.length),
      estimatedSavings: fractionOf(evidence.cost, MODEL_CHURN_SAVINGS_FRACTION),
      evidence,
      recipes: [
        recipe(
          'Choose model roles up front',
          'Use one model for exploration and one for edits instead of switching repeatedly inside the same task.',
        ),
      ],
    });
  }
  return findings;
}

function detectLongLowYield(events: readonly UsageEvent[]): Finding[] {
  const timestamps = new Map<string, string[]>();
  for (const event of events) {
    if (!event.sessionId?.trim()) continue;
    const key = sessionKey(event.provider, event.sessionId.trim());
    const list = timestamps.get(key) ?? [];
    list.push(event.timestamp);
    timestamps.set(key, list);
  }
  return buildSessionRollups([...events]).flatMap((session): Finding[] => {
    // Active time, not wall-clock span: a session resumed over two days is not "long".
    const activeMs = activeDurationMs(
      timestamps.get(sessionKey(session.provider, session.sessionId)) ?? [],
    );
    if (
      activeMs < LONG_SESSION_ACTIVE_MS ||
      session.cost <= 0 ||
      session.outputTokens / session.cost >= LOW_YIELD_OUTPUT_PER_DOLLAR
    ) {
      return [];
    }
    const label = describeProject(session.projectId, session.repoRoot) ?? session.sessionId;
    return [
      {
        kind: 'long-session-low-yield',
        title: 'Long session with low output per dollar',
        severity: severityFor(session.cost),
        confidence: confidenceFor(session.eventCount),
        estimatedSavings: fractionOf(session.cost, LOW_YIELD_SAVINGS_FRACTION),
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
          recipe(
            'Inspect the replay',
            'Review the session timeline for broad reads, stalled loops, or repeated commands.',
            `tokenleak replay ${session.start.slice(0, 10)}`,
          ),
        ],
      },
    ];
  });
}

/**
 * Keep the costliest sessions of each session-level kind and fold the rest
 * into a single "N more sessions" finding, so the report stays readable
 * without losing the total savings estimate.
 */
export function capSessionFindings(findings: Finding[]): Finding[] {
  const kept: Finding[] = [];
  const byKind = new Map<SavingsKind, Finding[]>();
  for (const finding of findings) {
    if (!SESSION_LEVEL_KINDS.has(finding.kind)) {
      kept.push(finding);
      continue;
    }
    const list = byKind.get(finding.kind) ?? [];
    list.push(finding);
    byKind.set(finding.kind, list);
  }
  for (const list of byKind.values()) {
    const ranked = list
      .slice()
      .sort(
        (a, b) =>
          (b.estimatedSavings ?? 0) - (a.estimatedSavings ?? 0) ||
          b.evidence.cost - a.evidence.cost,
      );
    kept.push(...ranked.slice(0, MAX_FINDINGS_PER_SESSION_KIND));
    const rest = ranked.slice(MAX_FINDINGS_PER_SESSION_KIND);
    if (rest.length === 0) continue;
    const savings = rest.reduce((sum, finding) => sum + (finding.estimatedSavings ?? 0), 0);
    const template = rest[0]!;
    kept.push({
      ...template,
      title: `${template.title} (${rest.length} more sessions)`,
      severity: severityFor(savings),
      estimatedSavings: savings > 0 ? savings : null,
      evidence: {
        eventCount: rest.reduce((sum, finding) => sum + finding.evidence.eventCount, 0),
        tokens: rest.reduce((sum, finding) => sum + finding.evidence.tokens, 0),
        cost: rest.reduce((sum, finding) => sum + finding.evidence.cost, 0),
        reason: `${rest.length} more sessions show the same pattern with smaller estimated savings.`,
      },
    });
  }
  return kept;
}

/** Findings about how sessions are run: growing context, retries, model churn, low yield. */
export function detectSessionFindings(
  events: readonly UsageEvent[],
  warnings: string[],
): Finding[] {
  const sessions = [...groupBySession(events).values()];
  return capSessionFindings([
    ...detectContextDrag(sessions),
    ...detectPromptRepeats(events, warnings),
    ...detectModelChurn(sessions),
    ...detectLongLowYield(events),
  ]);
}
