import { sessionKey } from './session-identity';
import type {
  FlowBlock,
  FlowBlockLabel,
  ProviderData,
  ReplayDaySummary,
  ReplayReport,
  TokenVelocityPoint,
  UsageEvent,
} from '../types';

const FLOW_BLOCK_GAP_MS = 15 * 60 * 1_000;
const DEEP_FLOW_DURATION_MS = 45 * 60 * 1_000;
const DEEP_FLOW_EVENT_COUNT = 5;
const QUICK_LOOKUP_DURATION_MS = 10 * 60 * 1_000;
const QUICK_LOOKUP_EVENT_COUNT = 2;
const VELOCITY_BUCKET_MS = 60 * 1_000;

function parseIsoTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function truncateToMinute(iso: string): string {
  const date = new Date(iso);
  date.setSeconds(0, 0);
  return date.toISOString();
}

function labelFlowBlock(durationMs: number, eventCount: number): FlowBlockLabel {
  if (durationMs >= DEEP_FLOW_DURATION_MS || eventCount >= DEEP_FLOW_EVENT_COUNT) {
    return 'Deep Flow';
  }
  if (durationMs <= QUICK_LOOKUP_DURATION_MS && eventCount <= QUICK_LOOKUP_EVENT_COUNT) {
    return 'Quick Lookup';
  }
  return 'Moderate Session';
}

function computeDominantModel(events: UsageEvent[]): string {
  const byModel = new Map<string, number>();
  for (const event of events) {
    byModel.set(event.model, (byModel.get(event.model) ?? 0) + event.totalTokens);
  }

  let best = '';
  let bestTokens = -1;
  for (const [model, tokens] of byModel) {
    if (tokens > bestTokens || (tokens === bestTokens && model < best)) {
      best = model;
      bestTokens = tokens;
    }
  }

  return best;
}

function countModelSwitches(events: UsageEvent[]): number {
  let switches = 0;
  for (let i = 1; i < events.length; i++) {
    if (events[i].model !== events[i - 1].model) {
      switches++;
    }
  }
  return switches;
}

function computeCacheHitRateTrend(events: UsageEvent[]): number[] {
  return events.map((event) => {
    const denominator = event.inputTokens + event.cacheReadTokens + event.cacheWriteTokens;
    return denominator > 0 ? event.cacheReadTokens / denominator : 0;
  });
}

function clusterIntoFlowBlocks(sortedEvents: UsageEvent[]): FlowBlock[] {
  if (sortedEvents.length === 0) {
    return [];
  }

  const blocks: FlowBlock[] = [];
  let currentEvents: UsageEvent[] = [sortedEvents[0]];

  for (let i = 1; i < sortedEvents.length; i++) {
    const prevTime = parseIsoTime(sortedEvents[i - 1].timestamp);
    const currTime = parseIsoTime(sortedEvents[i].timestamp);

    if (prevTime !== null && currTime !== null && currTime - prevTime >= FLOW_BLOCK_GAP_MS) {
      blocks.push(buildFlowBlock(currentEvents, blocks.length));
      currentEvents = [];
    }

    currentEvents.push(sortedEvents[i]);
  }

  blocks.push(buildFlowBlock(currentEvents, blocks.length));
  return blocks;
}

function buildFlowBlock(events: UsageEvent[], blockIndex: number): FlowBlock {
  const startTime = parseIsoTime(events[0].timestamp) ?? 0;
  const endTime = parseIsoTime(events[events.length - 1].timestamp) ?? 0;
  const durationMs = endTime - startTime;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;
  let cost = 0;

  for (const event of events) {
    inputTokens += event.inputTokens;
    outputTokens += event.outputTokens;
    cacheReadTokens += event.cacheReadTokens;
    cacheWriteTokens += event.cacheWriteTokens;
    totalTokens += event.totalTokens;
    cost += event.cost;
  }

  return {
    blockIndex,
    label: labelFlowBlock(durationMs, events.length),
    start: events[0].timestamp,
    end: events[events.length - 1].timestamp,
    durationMs,
    eventCount: events.length,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    cost,
    dominantModel: computeDominantModel(events),
    events,
    modelSwitches: countModelSwitches(events),
    cacheHitRateTrend: computeCacheHitRateTrend(events),
  };
}

function buildTokenVelocity(sortedEvents: UsageEvent[]): TokenVelocityPoint[] {
  const buckets = new Map<string, number>();

  for (const event of sortedEvents) {
    const minute = truncateToMinute(event.timestamp);
    buckets.set(minute, (buckets.get(minute) ?? 0) + event.totalTokens);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([minute, tokens]) => ({
      minute,
      tokensPerMinute: tokens / (VELOCITY_BUCKET_MS / 1_000 / 60),
    }));
}

function buildDaySummary(
  sortedEvents: UsageEvent[],
  flowBlocks: FlowBlock[],
  tokenVelocity: TokenVelocityPoint[],
): ReplayDaySummary {
  const sessionIds = new Set<string>();
  for (const event of sortedEvents) {
    if (event.sessionId) {
      sessionIds.add(sessionKey(event.provider, event.sessionId));
    }
  }

  let flowTimeMs = 0;
  for (const block of flowBlocks) {
    flowTimeMs += block.durationMs;
  }

  let thinkTimeMs = 0;
  for (let i = 1; i < flowBlocks.length; i++) {
    const prevEnd = parseIsoTime(flowBlocks[i - 1].end);
    const currStart = parseIsoTime(flowBlocks[i].start);
    if (prevEnd !== null && currStart !== null) {
      thinkTimeMs += currStart - prevEnd;
    }
  }

  const totalTimeMs = flowTimeMs + thinkTimeMs;
  const flowThinkRatio = totalTimeMs > 0 ? flowTimeMs / totalTimeMs : 0;

  let peakMinute: TokenVelocityPoint | null = null;
  for (const point of tokenVelocity) {
    if (peakMinute === null || point.tokensPerMinute > peakMinute.tokensPerMinute) {
      peakMinute = point;
    }
  }

  return {
    totalSessions: sessionIds.size,
    totalEvents: sortedEvents.length,
    flowTimeMs,
    thinkTimeMs,
    flowThinkRatio,
    peakMinute,
  };
}

export function buildReplayReport(providers: ProviderData[], targetDate: string): ReplayReport {
  const allEvents = providers.flatMap((provider) => provider.events ?? []);
  const dayEvents = allEvents
    .filter((event) => event.date === targetDate)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const flowBlocks = clusterIntoFlowBlocks(dayEvents);
  const tokenVelocity = buildTokenVelocity(dayEvents);
  const summary = buildDaySummary(dayEvents, flowBlocks, tokenVelocity);

  return {
    date: targetDate,
    events: dayEvents,
    flowBlocks,
    tokenVelocity,
    summary,
  };
}
