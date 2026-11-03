import type {
  OptimizationConfidence,
  OptimizationEvidence,
  SavingsCategory,
  SavingsKind,
  SavingsRecommendation,
  UsageEvent,
  WasteRecipe,
} from '../types';

export const TOKENS_PER_MILLION = 1_000_000;
export const DAYS_PER_MONTH = 30;
/** Savings at or above this many dollars are high severity. */
const HIGH_SEVERITY_DOLLARS = 10;
/** Savings at or above this many dollars are medium severity. */
const MEDIUM_SEVERITY_DOLLARS = 2;
/** Evidence from fewer events than this is low confidence. */
const MEDIUM_CONFIDENCE_EVENTS = 3;
/** Evidence from at least this many events is high confidence. */
const HIGH_CONFIDENCE_EVENTS = 6;

export const KIND_CATEGORY: Readonly<Record<SavingsKind, SavingsCategory>> = {
  'model-routing': 'routing',
  'cache-miss-heavy': 'cache',
  'cache-write-waste': 'cache',
  'context-drag': 'session',
  'prompt-repeat': 'session',
  'model-churn': 'session',
  'long-session-low-yield': 'session',
  'cost-concentration': 'spend',
  'rising-cost': 'spend',
  'burst-day': 'spend',
};

/** Everything a detector decides; the engine fills in category and monthly savings. */
export type Finding = Omit<SavingsRecommendation, 'category' | 'monthlySavings'>;

export function severityFor(
  dollars: number,
  fallback: SavingsRecommendation['severity'] = 'low',
): SavingsRecommendation['severity'] {
  if (dollars >= HIGH_SEVERITY_DOLLARS) return 'high';
  if (dollars >= MEDIUM_SEVERITY_DOLLARS) return 'medium';
  return fallback;
}

export function confidenceFor(eventCount: number, degraded = false): OptimizationConfidence {
  if (degraded || eventCount < MEDIUM_CONFIDENCE_EVENTS) return 'low';
  if (eventCount < HIGH_CONFIDENCE_EVENTS) return 'medium';
  return 'high';
}

export function recipe(title: string, detail: string, command?: string): WasteRecipe {
  return command === undefined ? { title, detail } : { title, detail, command };
}

export function evidenceFromEvents(
  events: readonly UsageEvent[],
  reason: string,
): OptimizationEvidence {
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

/** A share of `cost` as savings, or null when there is no cost to save. */
export function fractionOf(cost: number, fraction: number): number | null {
  return cost > 0 ? cost * fraction : null;
}
