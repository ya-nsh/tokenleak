import { basename } from 'node:path';
import type {
  BlackBoxEdge,
  BlackBoxNode,
  BlackBoxTarget,
  BlackBoxTrace,
  DateRange,
  NutritionOutcomeSignal,
  ProviderData,
  UsageEvent,
} from '../types';

const METHOD =
  'Black Box trace v1: deterministic cost-causality graph from local provider events, prompts, sessions, cache signals, model churn, and optional Git outcome signals.';
const FLOW_GAP_MS = 15 * 60 * 1_000;
const LOW_CACHE_HIT_RATE = 0.25;
const LOW_OUTPUT_YIELD = 0.12;
const CONTEXT_DRAG_RATIO = 8;
const PROMPT_SNIPPET_LIMIT = 78;

interface SessionGroup {
  key: string;
  sessionId: string;
  provider: string;
  events: UsageEvent[];
  start: string;
  end: string;
  date: string;
  projectLabel: string | null;
  tokens: number;
  cost: number;
}

interface FlowGroup {
  index: number;
  events: UsageEvent[];
  start: string;
  end: string;
  tokens: number;
  cost: number;
  model: string;
}

export interface BuildBlackBoxTraceOptions {
  targetIndex?: number;
  outcomeSignals?: NutritionOutcomeSignal[];
}

function eventTime(event: UsageEvent): number {
  const parsed = Date.parse(event.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inRange(event: UsageEvent, range: DateRange): boolean {
  return event.date >= range.since && event.date <= range.until;
}

function sessionKey(event: UsageEvent): string {
  return `${event.provider}:${event.sessionId?.trim() || event.projectId?.trim() || event.timestamp}`;
}

function sessionLabel(event: UsageEvent): string {
  return event.sessionId?.trim() || event.projectId?.trim() || event.timestamp;
}

function projectLabel(events: UsageEvent[]): string | null {
  const repo = events.find((event) => event.repoRoot?.trim())?.repoRoot;
  if (repo) return basename(repo) || repo;
  const project = events.find((event) => event.projectId?.trim())?.projectId;
  if (!project) return null;
  return basename(project) || project;
}

function clampIndex(index: number | undefined, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index ?? 0, length - 1));
}

function collectEvents(providers: ProviderData[], range: DateRange): UsageEvent[] {
  return providers
    .flatMap((provider) => provider.events ?? [])
    .filter((event) => inRange(event, range))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function buildSessions(events: UsageEvent[]): SessionGroup[] {
  const byKey = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = sessionKey(event);
    const list = byKey.get(key) ?? [];
    list.push(event);
    byKey.set(key, list);
  }

  return [...byKey.entries()]
    .map(([key, sessionEvents]) => {
      const ordered = sessionEvents.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const first = ordered[0]!;
      const last = ordered[ordered.length - 1]!;
      return {
        key,
        sessionId: sessionLabel(first),
        provider: first.provider,
        events: ordered,
        start: first.timestamp,
        end: last.timestamp,
        date: last.date,
        projectLabel: projectLabel(ordered),
        tokens: ordered.reduce((sum, event) => sum + event.totalTokens, 0),
        cost: ordered.reduce((sum, event) => sum + event.cost, 0),
      };
    })
    .sort((a, b) => b.end.localeCompare(a.end) || b.cost - a.cost || b.tokens - a.tokens);
}

function toTarget(session: SessionGroup): BlackBoxTarget {
  return {
    key: session.key,
    date: session.date,
    sessionId: session.sessionId,
    label: session.projectLabel ?? session.sessionId,
    provider: session.provider,
    projectLabel: session.projectLabel,
    eventCount: session.events.length,
    tokens: session.tokens,
    cost: session.cost,
    start: session.start,
    end: session.end,
  };
}

function dominantModel(events: UsageEvent[]): string {
  const totals = new Map<string, number>();
  for (const event of events) {
    totals.set(event.model, (totals.get(event.model) ?? 0) + event.totalTokens);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'unknown';
}

function flowGroups(events: UsageEvent[]): FlowGroup[] {
  const groups: UsageEvent[][] = [];
  let current: UsageEvent[] = [];
  for (const event of events) {
    const prev = current.at(-1);
    if (prev && eventTime(event) - eventTime(prev) >= FLOW_GAP_MS) {
      groups.push(current);
      current = [];
    }
    current.push(event);
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group, index) => ({
    index,
    events: group,
    start: group[0]!.timestamp,
    end: group[group.length - 1]!.timestamp,
    tokens: group.reduce((sum, event) => sum + event.totalTokens, 0),
    cost: group.reduce((sum, event) => sum + event.cost, 0),
    model: dominantModel(group),
  }));
}

function severity(cost: number, tokens: number): BlackBoxNode['severity'] {
  if (cost >= 5 || tokens >= 100_000) return 'high';
  if (cost >= 1 || tokens >= 25_000) return 'medium';
  if (cost > 0 || tokens > 0) return 'low';
  return 'info';
}

export function redactPromptSnippet(prompt: string | undefined): string | undefined {
  if (!prompt?.trim()) return undefined;
  const compact = prompt
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.-]+){2,}/g, '[path]')
    .replace(/\b(?:sk|pk|ghp|gho|ghu|ghs|xox[baprs])_[A-Za-z0-9_=-]{12,}\b/g, '[secret]')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length <= PROMPT_SNIPPET_LIMIT
    ? compact
    : `${compact.slice(0, PROMPT_SNIPPET_LIMIT - 1)}…`;
}

function cacheHitRate(events: UsageEvent[]): number {
  const input = events.reduce((sum, event) => sum + event.inputTokens, 0);
  const read = events.reduce((sum, event) => sum + event.cacheReadTokens, 0);
  return input + read > 0 ? read / (input + read) : 0;
}

function outputYield(event: UsageEvent): number {
  return event.totalTokens > 0 ? event.outputTokens / event.totalTokens : 0;
}

function countModelSwitches(events: UsageEvent[]): number {
  let switches = 0;
  for (let i = 1; i < events.length; i++) {
    if (events[i]!.model !== events[i - 1]!.model) switches += 1;
  }
  return switches;
}

function pushEdge(edges: BlackBoxEdge[], from: string, to: string, kind: BlackBoxEdge['kind'], label?: string): void {
  edges.push({ from, to, kind, label });
}

function matchingOutcomeSignal(
  events: UsageEvent[],
  signals: NutritionOutcomeSignal[],
): NutritionOutcomeSignal | null {
  const repoRoots = new Set(events.map((event) => event.repoRoot?.trim()).filter(Boolean) as string[]);
  for (const signal of signals) {
    if (repoRoots.has(signal.repoRoot)) return signal;
  }
  return null;
}

export function buildBlackBoxTrace(
  providers: ProviderData[],
  dateRange: DateRange,
  options: BuildBlackBoxTraceOptions = {},
): BlackBoxTrace {
  const events = collectEvents(providers, dateRange);
  const sessions = buildSessions(events);
  const targets = sessions.map(toTarget);
  const targetSession = sessions[clampIndex(options.targetIndex, sessions.length)] ?? null;
  const warnings: string[] = [];

  if (!targetSession) {
    return {
      method: METHOD,
      dateRange,
      target: null,
      targets,
      nodes: [],
      edges: [],
      hotPathNodeIds: [],
      wasteNodeIds: [],
      churnNodeIds: [],
      summary: {
        totalEvents: 0,
        totalTokens: 0,
        totalCost: 0,
        cacheHitRate: 0,
        modelSwitches: 0,
        wasteSignals: 0,
        gitOutcomeSignals: 0,
      },
      warnings: ['No event-level sessions were found in this window.'],
    };
  }

  const sessionNodeId = `session:${targetSession.key}`;
  const nodes: BlackBoxNode[] = [{
    id: sessionNodeId,
    kind: 'session',
    label: targetSession.projectLabel ?? 'session',
    timestamp: targetSession.start,
    provider: targetSession.provider,
    tokens: targetSession.tokens,
    cost: targetSession.cost,
    severity: severity(targetSession.cost, targetSession.tokens),
    reason: 'Selected latest meaningful local AI session.',
    details: [
      `${targetSession.events.length} events from ${targetSession.start} to ${targetSession.end}.`,
      targetSession.projectLabel ? `Project label: ${targetSession.projectLabel}.` : 'No project label captured.',
    ],
    eventCount: targetSession.events.length,
  }];
  const edges: BlackBoxEdge[] = [];
  const hotPathNodeIds = [sessionNodeId];
  const wasteNodeIds: string[] = [];
  const churnNodeIds: string[] = [];

  const flows = flowGroups(targetSession.events);
  const topFlow = flows.slice().sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)[0];
  let previousFlowId: string | null = null;
  for (const flow of flows) {
    const flowId = `flow:${targetSession.key}:${flow.index}`;
    if (flow === topFlow) hotPathNodeIds.push(flowId);
    nodes.push({
      id: flowId,
      kind: 'flow-block',
      label: `flow ${flow.index + 1}`,
      timestamp: flow.start,
      provider: targetSession.provider,
      model: flow.model,
      tokens: flow.tokens,
      cost: flow.cost,
      severity: severity(flow.cost, flow.tokens),
      reason: flow === topFlow ? 'Most expensive flow block in this session.' : 'Chronological flow block.',
      details: [
        `${flow.events.length} events clustered within a ${Math.round(FLOW_GAP_MS / 60_000)} minute activity gap.`,
        `Dominant model: ${flow.model}.`,
      ],
      eventCount: flow.events.length,
    });
    pushEdge(edges, sessionNodeId, flowId, 'contains', 'contains');
    if (previousFlowId) pushEdge(edges, previousFlowId, flowId, 'chronology', 'then');
    previousFlowId = flowId;

    let previousEventId: string | null = null;
    const visibleEvents = flow.events
      .map((event, index) => ({ event, index }))
      .sort((a, b) => b.event.cost - a.event.cost || b.event.totalTokens - a.event.totalTokens)
      .slice(0, 4)
      .sort((a, b) => a.event.timestamp.localeCompare(b.event.timestamp));
    for (const entry of visibleEvents) {
      const event = entry.event;
      const eventId = `event:${targetSession.key}:${flow.index}:${entry.index}`;
      const isHot = event === targetSession.events.slice().sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens)[0];
      if (isHot) hotPathNodeIds.push(eventId);
      const yieldRatio = outputYield(event);
      nodes.push({
        id: eventId,
        kind: 'event',
        label: redactPromptSnippet(event.prompt) ?? event.model,
        timestamp: event.timestamp,
        provider: event.provider,
        model: event.model,
        tokens: event.totalTokens,
        cost: event.cost,
        severity: severity(event.cost, event.totalTokens),
        snippet: redactPromptSnippet(event.prompt),
        reason: isHot ? 'Highest-cost turn in the selected session.' : 'Representative costly turn in this flow.',
        details: [
          `Input ${event.inputTokens.toLocaleString('en-US')}, output ${event.outputTokens.toLocaleString('en-US')}.`,
          `Cache read ${event.cacheReadTokens.toLocaleString('en-US')}, write ${event.cacheWriteTokens.toLocaleString('en-US')}.`,
          `Output yield ${(yieldRatio * 100).toFixed(0)}% of total tokens.`,
        ],
        eventCount: 1,
      });
      pushEdge(edges, flowId, eventId, 'contains', 'turn');
      if (previousEventId) pushEdge(edges, previousEventId, eventId, 'chronology', 'then');
      previousEventId = eventId;
    }
  }

  const modelSwitches = countModelSwitches(targetSession.events);
  if (modelSwitches > 0) {
    const churnId = `churn:${targetSession.key}`;
    churnNodeIds.push(churnId);
    nodes.push({
      id: churnId,
      kind: 'model-switch',
      label: `${modelSwitches} model switch${modelSwitches === 1 ? '' : 'es'}`,
      provider: targetSession.provider,
      tokens: targetSession.tokens,
      cost: targetSession.cost,
      severity: modelSwitches >= 3 ? 'medium' : 'low',
      reason: 'Model changed inside the selected session.',
      details: ['Frequent model changes can indicate uncertainty, handoff friction, or routing experimentation.'],
      eventCount: targetSession.events.length,
    });
    pushEdge(edges, sessionNodeId, churnId, 'signal', 'churn');
  }

  const sessionCacheHit = cacheHitRate(targetSession.events);
  if (sessionCacheHit < LOW_CACHE_HIT_RATE && targetSession.events.some((event) => event.inputTokens + event.cacheReadTokens > 0)) {
    const cacheId = `cache:${targetSession.key}`;
    churnNodeIds.push(cacheId);
    nodes.push({
      id: cacheId,
      kind: 'cache',
      label: `cache hit ${(sessionCacheHit * 100).toFixed(0)}%`,
      provider: targetSession.provider,
      tokens: targetSession.events.reduce((sum, event) => sum + event.cacheWriteTokens, 0),
      cost: targetSession.cost,
      severity: 'medium',
      reason: 'Low prompt-cache reuse in the selected session.',
      details: ['Stable context may not be paying back; repeated broad context can inflate input spend.'],
      eventCount: targetSession.events.length,
    });
    pushEdge(edges, sessionNodeId, cacheId, 'signal', 'cache');
  }

  const input = targetSession.events.reduce((sum, event) => sum + event.inputTokens, 0);
  const output = targetSession.events.reduce((sum, event) => sum + event.outputTokens, 0);
  const lowYieldEvents = targetSession.events.filter((event) => outputYield(event) <= LOW_OUTPUT_YIELD && event.totalTokens > 0);
  if ((output > 0 && input / output >= CONTEXT_DRAG_RATIO) || lowYieldEvents.length >= 2) {
    const wasteId = `waste:${targetSession.key}:context`;
    wasteNodeIds.push(wasteId);
    nodes.push({
      id: wasteId,
      kind: 'waste',
      label: 'context drag',
      provider: targetSession.provider,
      tokens: lowYieldEvents.reduce((sum, event) => sum + event.totalTokens, 0) || targetSession.tokens,
      cost: lowYieldEvents.reduce((sum, event) => sum + event.cost, 0) || targetSession.cost,
      severity: 'high',
      reason: output > 0
        ? `Input/output ratio is ${(input / output).toFixed(1)}x.`
        : 'Multiple events had very low output yield.',
      details: ['This is the classic Black Box red path: expensive context in, limited visible output out.'],
      eventCount: lowYieldEvents.length || targetSession.events.length,
    });
    pushEdge(edges, sessionNodeId, wasteId, 'cost', 'leak');
  }

  const outcome = matchingOutcomeSignal(targetSession.events, options.outcomeSignals ?? []);
  if (outcome) {
    const outcomeId = `outcome:${outcome.repoRoot}`;
    nodes.push({
      id: outcomeId,
      kind: 'outcome',
      label: `${outcome.commits} commits / ${outcome.changedLines} lines`,
      tokens: 0,
      cost: 0,
      severity: outcome.commits > 0 || outcome.changedLines > 0 ? 'info' : 'low',
      reason: 'Local Git outcome signal matched this session repo.',
      details: [
        `${outcome.changedFiles} files changed, ${outcome.changedLines} changed lines.`,
        `Repo: ${basename(outcome.repoRoot) || outcome.repoRoot}.`,
      ],
    });
    pushEdge(edges, sessionNodeId, outcomeId, 'outcome', 'shipped');
  } else if (targetSession.events.some((event) => event.repoRoot)) {
    warnings.push('Git outcome signals are not loaded for this trace yet.');
  }

  const summary = {
    totalEvents: targetSession.events.length,
    totalTokens: targetSession.tokens,
    totalCost: targetSession.cost,
    cacheHitRate: sessionCacheHit,
    modelSwitches,
    wasteSignals: wasteNodeIds.length,
    gitOutcomeSignals: outcome ? 1 : 0,
  };

  const sortedHotIds = nodes
    .filter((node) => node.kind === 'event')
    .sort((a, b) => b.cost - a.cost || b.tokens - a.tokens)
    .slice(0, 3)
    .map((node) => node.id);
  for (const id of sortedHotIds) {
    if (!hotPathNodeIds.includes(id)) hotPathNodeIds.push(id);
  }

  return {
    method: METHOD,
    dateRange,
    target: toTarget(targetSession),
    targets,
    nodes,
    edges,
    hotPathNodeIds,
    wasteNodeIds,
    churnNodeIds,
    summary,
    warnings,
  };
}
