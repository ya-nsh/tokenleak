import type { TokenleakOutput, UsageEvent, WasteFinding, WasteReport } from '../types';

const METHOD =
  'Waste taxonomy v1: deterministic findings from local token, cache, model, daily, and session signals. Findings are optimization leads, not proof of bad usage.';

const LOW_CACHE_HIT_RATE = 0.3;
const LOW_REUSE_RATIO = 2;
const CONTEXT_DRAG_INPUT_PER_OUTPUT = 8;
const BURST_MULTIPLIER = 3;
const SHORT_OUTPUT_THRESHOLD = 1_000;
const MIN_EVENT_EVIDENCE = 3;

interface ModelStats {
  provider: string;
  model: string;
  events: number;
  outputTokens: number;
  cost: number;
}

function severityForSavings(value: number): WasteFinding['severity'] {
  if (value >= 25) return 'high';
  if (value >= 5) return 'medium';
  return 'low';
}

function monthlySavings(observedCost: number, observedDays: number, fraction: number): number {
  if (observedDays <= 0) return 0;
  return (observedCost / observedDays) * 30 * fraction;
}

function collectModelStats(events: UsageEvent[]): ModelStats[] {
  const byModel = new Map<string, ModelStats>();

  for (const event of events) {
    const key = `${event.provider}:${event.model}`;
    const current = byModel.get(key) ?? {
      provider: event.provider,
      model: event.model,
      events: 0,
      outputTokens: 0,
      cost: 0,
    };
    current.events += 1;
    current.outputTokens += event.outputTokens;
    current.cost += event.cost;
    byModel.set(key, current);
  }

  return [...byModel.values()];
}

function detectPremiumShortOutput(events: UsageEvent[], observedDays: number): WasteFinding[] {
  return collectModelStats(events)
    .filter((stats) => stats.events >= MIN_EVENT_EVIDENCE)
    .map((stats) => ({
      stats,
      averageOutput: stats.outputTokens / stats.events,
      savings: monthlySavings(stats.cost, observedDays, 0.35),
    }))
    .filter((entry) => entry.averageOutput < SHORT_OUTPUT_THRESHOLD && entry.savings > 0)
    .sort((left, right) => right.savings - left.savings)
    .slice(0, 3)
    .map((entry): WasteFinding => ({
      category: 'premium-short-output',
      severity: severityForSavings(entry.savings),
      title: `Short outputs on ${entry.stats.model}`,
      evidence: `${entry.stats.events} events averaged ${Math.round(entry.averageOutput).toLocaleString('en-US')} output tokens.`,
      provider: entry.stats.provider,
      model: entry.stats.model,
      estimatedMonthlySavings: entry.savings,
      recipes: [
        {
          title: 'Route short lookups to a cheaper model',
          detail: 'Use the expensive model for planning and hard edits, then switch routine explanations, grep-style lookups, and small rewrites to a cheaper model.',
        },
      ],
    }));
}

function detectCacheFindings(output: TokenleakOutput, observedDays: number): WasteFinding[] {
  const findings: WasteFinding[] = [];

  if (output.aggregated.cacheHitRate < LOW_CACHE_HIT_RATE) {
    const savings = monthlySavings(output.aggregated.totalCost, observedDays, 0.15);
    findings.push({
      category: 'low-cache-hit-rate',
      severity: severityForSavings(savings),
      title: 'Low prompt-cache hit rate',
      evidence: `Cache hit rate is ${Math.round(output.aggregated.cacheHitRate * 100)}%, below the ${Math.round(LOW_CACHE_HIT_RATE * 100)}% threshold.`,
      estimatedMonthlySavings: savings,
      recipes: [
        {
          title: 'Stabilize reusable context',
          command: 'tokenleak --more --format json',
          detail: 'Move stable repo instructions into persistent project guidance and avoid re-sending large changing context blocks when a shorter reference will do.',
        },
      ],
    });
  }

  const cacheEconomics = output.more?.cacheEconomics;
  if (
    cacheEconomics &&
    cacheEconomics.writeTokens > 0 &&
    cacheEconomics.reuseRatio !== null &&
    cacheEconomics.reuseRatio < LOW_REUSE_RATIO
  ) {
    findings.push({
      category: 'wasted-cache-writes',
      severity: cacheEconomics.writeTokens > 100_000 ? 'medium' : 'low',
      title: 'Cache writes are not being reused',
      evidence: `Cache reuse ratio is ${cacheEconomics.reuseRatio.toFixed(1)}x from ${cacheEconomics.writeTokens.toLocaleString('en-US')} write tokens.`,
      estimatedMonthlySavings: null,
      recipes: [
        {
          title: 'Reduce one-off cache writes',
          detail: 'Batch related work into fewer sessions and keep stable instructions unchanged so cache writes can pay back through repeated reads.',
        },
      ],
    });
  }

  return findings;
}

function detectContextDrag(output: TokenleakOutput, observedDays: number): WasteFinding[] {
  const inputPerOutput = output.more?.inputOutput.inputPerOutput;
  if (inputPerOutput === null || inputPerOutput === undefined || inputPerOutput < CONTEXT_DRAG_INPUT_PER_OUTPUT) {
    return [];
  }

  const savings = monthlySavings(output.aggregated.totalCost, observedDays, 0.2);
  return [{
    category: 'context-drag',
    severity: severityForSavings(savings),
    title: 'High input-to-output ratio',
    evidence: `Input tokens are ${inputPerOutput.toFixed(1)}x output tokens.`,
    estimatedMonthlySavings: savings,
    recipes: [
      {
        title: 'Summarize before continuing',
        detail: 'Ask the assistant to produce a compact handoff, start a fresh session, and point it at only the files needed for the next step.',
      },
    ],
  }];
}

function detectBurstSpike(output: TokenleakOutput): WasteFinding[] {
  const activeDays = output.providers
    .flatMap((provider) => provider.daily)
    .filter((day) => day.totalTokens > 0);
  if (activeDays.length < 3) {
    return [];
  }

  const average = activeDays.reduce((sum, day) => sum + day.totalTokens, 0) / activeDays.length;
  const peak = activeDays.reduce((best, day) => day.totalTokens > best.totalTokens ? day : best, activeDays[0]!);
  if (peak.totalTokens < average * BURST_MULTIPLIER) {
    return [];
  }

  return [{
    category: 'burst-spike',
    severity: peak.cost >= 10 ? 'high' : peak.cost >= 2 ? 'medium' : 'low',
    title: 'Unusual token burst',
    evidence: `${peak.date} used ${peak.totalTokens.toLocaleString('en-US')} tokens, ${Math.round(peak.totalTokens / average)}x the active-day average.`,
    estimatedMonthlySavings: null,
    recipes: [
      {
        title: 'Review the burst day',
        command: `tokenleak explain ${peak.date}`,
        detail: 'Inspect the highest-cost sessions from that day and look for repeated failed loops, broad file reads, or model overuse.',
      },
    ],
  }];
}

function detectModelSwitchChurn(events: UsageEvent[]): WasteFinding[] {
  const bySession = new Map<string, UsageEvent[]>();
  for (const event of events) {
    if (!event.sessionId) continue;
    const sessionEvents = bySession.get(event.sessionId) ?? [];
    sessionEvents.push(event);
    bySession.set(event.sessionId, sessionEvents);
  }

  for (const [sessionId, sessionEvents] of bySession) {
    const ordered = sessionEvents.slice().sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    let switches = 0;
    for (let index = 1; index < ordered.length; index++) {
      if (ordered[index]!.model !== ordered[index - 1]!.model) {
        switches += 1;
      }
    }

    if (switches >= 3 && switches / ordered.length >= 0.4) {
      return [{
        category: 'model-switch-churn',
        severity: 'low',
        title: 'Frequent model switching inside a session',
        evidence: `Session ${sessionId} switched models ${switches} times across ${ordered.length} events.`,
        estimatedMonthlySavings: null,
        recipes: [
          {
            title: 'Choose model roles before starting',
            detail: 'Use one model for exploration and one for implementation instead of switching repeatedly inside the same task.',
          },
        ],
      }];
    }
  }

  return [];
}

function observedDays(output: TokenleakOutput): number {
  return Math.max(1, output.aggregated.totalDays || output.aggregated.activeDays || 1);
}

export function buildWasteReport(output: TokenleakOutput): WasteReport {
  const events = output.providers.flatMap((provider) => provider.events ?? []);
  const days = observedDays(output);
  const findings = [
    ...detectPremiumShortOutput(events, days),
    ...detectCacheFindings(output, days),
    ...detectContextDrag(output, days),
    ...detectBurstSpike(output),
    ...detectModelSwitchChurn(events),
  ].sort((left, right) => {
    const severityRank = { high: 3, medium: 2, low: 1 };
    return (
      severityRank[right.severity] - severityRank[left.severity] ||
      (right.estimatedMonthlySavings ?? 0) - (left.estimatedMonthlySavings ?? 0) ||
      left.title.localeCompare(right.title)
    );
  });

  return {
    method: METHOD,
    dateRange: output.dateRange,
    enoughEvidence: events.length >= MIN_EVENT_EVIDENCE || output.aggregated.activeDays >= 3,
    findings,
  };
}
