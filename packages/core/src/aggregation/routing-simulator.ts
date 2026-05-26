import type {
  DateRange,
  OptimizationConfidence,
  RoutingRule,
  RoutingSimulationCandidate,
  RoutingSimulationReport,
  UsageEvent,
} from '../types';

const METHOD =
  'Model routing simulator v1: re-prices historical events under deterministic downgrade rules. Savings are estimates, not enforcement.';
const TOKENS_PER_MILLION = 1_000_000;
const SHORT_OUTPUT_TOKENS = 1_000;
const QUICK_LOOKUP_TOKENS = 8_000;
const QUICK_LOOKUP_DURATION_MS = 10 * 60 * 1_000;
const LOW_OUTPUT_RATIO = 0.08;
const SPARSE_MATCH_COUNT = 5;

export interface RoutingModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface BuildRoutingSimulationOptions {
  strategy?: 'conservative' | 'aggressive' | 'manual' | string;
  rules?: RoutingRule[];
  downgradePath?: (model: string) => string | null;
}

function normalizeModel(model: string): string {
  let normalized = model.toLowerCase().trim();
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex >= 0) {
    normalized = normalized.slice(slashIndex + 1);
  }
  return normalized.replace(/-\d{4}-?\d{2}-?\d{2}$/, '');
}

function defaultDowngradePath(model: string): string | null {
  const normalized = normalizeModel(model);
  const paths: Record<string, string> = {
    'claude-opus-4-6': 'claude-sonnet-4-6',
    'claude-opus-4': 'claude-sonnet-4',
    'claude-opus-4-5': 'claude-sonnet-4-5',
    'claude-sonnet-4-5': 'claude-haiku-4-5',
    'claude-3-opus': 'claude-3.5-sonnet',
    'claude-3-sonnet': 'claude-3-haiku',
    'claude-3.5-sonnet': 'claude-3.5-haiku',
    'gpt-4o': 'gpt-4o-mini',
    'gpt-5.5': 'gpt-5-mini',
    'gpt-5.4': 'gpt-5.4-mini',
    'gpt-5': 'gpt-5-mini',
    o1: 'o1-mini',
    o3: 'o3-mini',
  };
  return paths[normalized] ?? null;
}

function eventId(event: UsageEvent, index: number): string {
  return [
    event.provider,
    event.sessionId ?? 'no-session',
    event.timestamp,
    index,
  ].join(':');
}

function hasMalformedTokens(event: UsageEvent): boolean {
  return [
    event.inputTokens,
    event.outputTokens,
    event.cacheReadTokens,
    event.cacheWriteTokens,
    event.totalTokens,
  ].some((value) => !Number.isFinite(value) || value < 0);
}

function priceEvent(event: UsageEvent, pricing: RoutingModelPricing): number {
  return (
    (event.inputTokens / TOKENS_PER_MILLION) * pricing.input +
    (event.outputTokens / TOKENS_PER_MILLION) * pricing.output +
    (event.cacheReadTokens / TOKENS_PER_MILLION) * pricing.cacheRead +
    (event.cacheWriteTokens / TOKENS_PER_MILLION) * pricing.cacheWrite
  );
}

function confidenceFor(event: UsageEvent, matchedCount: number, reasons: string[]): OptimizationConfidence {
  if (matchedCount < SPARSE_MATCH_COUNT || event.costSource === 'unpriced') {
    return 'low';
  }
  if (event.costSource === 'provider-reported' || reasons.some((reason) => reason.includes('cache'))) {
    return 'medium';
  }
  return 'high';
}

function builtInRuleFor(event: UsageEvent, downgradeTo: string): RoutingRule | null {
  if (event.outputTokens > 0 && event.outputTokens <= SHORT_OUTPUT_TOKENS) {
    return {
      id: 'premium-short-output',
      label: 'Premium model with short output',
      kind: 'premium-short-output',
      fromModels: [event.model],
      toModel: downgradeTo,
      provider: event.provider,
      maxOutputTokens: SHORT_OUTPUT_TOKENS,
    };
  }

  if (
    event.totalTokens <= QUICK_LOOKUP_TOKENS ||
    (typeof event.durationMs === 'number' && event.durationMs <= QUICK_LOOKUP_DURATION_MS)
  ) {
    return {
      id: 'quick-lookup',
      label: 'Quick lookup downgrade',
      kind: 'quick-lookup',
      fromModels: [event.model],
      toModel: downgradeTo,
      provider: event.provider,
      maxTotalTokens: QUICK_LOOKUP_TOKENS,
      maxDurationMs: QUICK_LOOKUP_DURATION_MS,
    };
  }

  const ratio = event.inputTokens > 0 ? event.outputTokens / event.inputTokens : null;
  if (ratio !== null && ratio <= LOW_OUTPUT_RATIO && event.outputTokens <= SHORT_OUTPUT_TOKENS * 2) {
    return {
      id: 'low-output-ratio',
      label: 'Low output ratio downgrade',
      kind: 'low-output-ratio',
      fromModels: [event.model],
      toModel: downgradeTo,
      provider: event.provider,
      maxOutputTokens: SHORT_OUTPUT_TOKENS * 2,
    };
  }

  return null;
}

function manualRuleFor(event: UsageEvent, rules: RoutingRule[]): RoutingRule | null {
  const model = normalizeModel(event.model);
  return rules.find((rule) => {
    if (rule.provider && rule.provider !== event.provider) return false;
    if (!rule.fromModels.map(normalizeModel).includes(model)) return false;
    if (typeof rule.maxOutputTokens === 'number' && event.outputTokens > rule.maxOutputTokens) return false;
    if (typeof rule.maxTotalTokens === 'number' && event.totalTokens > rule.maxTotalTokens) return false;
    if (
      typeof rule.maxDurationMs === 'number' &&
      typeof event.durationMs === 'number' &&
      event.durationMs > rule.maxDurationMs
    ) {
      return false;
    }
    return true;
  }) ?? null;
}

export function buildRoutingSimulationReport(
  events: UsageEvent[],
  dateRange: DateRange,
  pricing: Readonly<Record<string, RoutingModelPricing>>,
  options: BuildRoutingSimulationOptions = {},
): RoutingSimulationReport {
  const strategy = options.strategy ?? 'conservative';
  const warnings: string[] = [];
  const candidates: RoutingSimulationCandidate[] = [];
  const rulesById = new Map<string, RoutingRule>();
  const downgradePath = options.downgradePath ?? defaultDowngradePath;
  let currentCost = 0;

  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;
    currentCost += Number.isFinite(event.cost) && event.cost > 0 ? event.cost : 0;

    if (hasMalformedTokens(event)) {
      warnings.push(`Skipped ${event.provider} event at ${event.timestamp}: negative token counts are not routable.`);
      continue;
    }
    if (event.inputTokens === 0 && event.outputTokens === 0) {
      warnings.push(`Skipped ${event.provider} event at ${event.timestamp}: no input/output tokens.`);
      continue;
    }

    const manualRule = manualRuleFor(event, options.rules ?? []);
    const targetModel = manualRule?.toModel ?? downgradePath(event.model);
    if (!targetModel) {
      warnings.push(`No downgrade path for ${event.model}.`);
      continue;
    }
    if (normalizeModel(targetModel) === normalizeModel(event.model)) {
      warnings.push(`Skipped ${event.model}: routing target matches source model.`);
      continue;
    }

    const rule = manualRule ?? builtInRuleFor(event, targetModel);
    if (!rule || strategy === 'manual' && !manualRule) {
      continue;
    }

    const targetPricing = pricing[normalizeModel(targetModel)];
    if (!targetPricing) {
      warnings.push(`Missing pricing for routing target ${targetModel}.`);
      continue;
    }

    const simulatedCost = priceEvent(event, targetPricing);
    const eventCost = Number.isFinite(event.cost) && event.cost >= 0 ? event.cost : 0;
    const reasons = [rule.label];
    if (event.costSource === 'provider-reported') {
      reasons.push('provider reported current cost');
    }
    if ((event.cacheReadTokens > 0 || event.cacheWriteTokens > 0) && targetPricing) {
      reasons.push('cache-aware target pricing');
    }

    rulesById.set(rule.id, rule);
    candidates.push({
      ruleId: rule.id,
      eventId: eventId(event, index),
      provider: event.provider,
      fromModel: event.model,
      toModel: targetModel,
      currentCost: eventCost,
      simulatedCost,
      savings: eventCost - simulatedCost,
      tokens: event.totalTokens,
      confidence: 'medium',
      reasons,
    });
  }

  const matchedCount = candidates.length;
  for (const candidate of candidates) {
    const event = events.find((entry, index) => eventId(entry, index) === candidate.eventId);
    if (event) {
      candidate.confidence = confidenceFor(event, matchedCount, candidate.reasons);
    }
  }

  const positiveCandidates = candidates.filter((candidate) => (candidate.savings ?? 0) > 0);
  const estimatedSavings = positiveCandidates.reduce((sum, candidate) => sum + (candidate.savings ?? 0), 0);
  const affectedTokens = positiveCandidates.reduce((sum, candidate) => sum + candidate.tokens, 0);

  if (warnings.some((warning) => warning.includes('Missing pricing') || warning.includes('No downgrade'))) {
    warnings.push('Savings are calculated on the priced subset only.');
  }

  return {
    method: METHOD,
    dateRange,
    strategy,
    currentCost,
    simulatedCost: currentCost - estimatedSavings,
    estimatedSavings,
    estimatedSavingsPercent: currentCost > 0 ? estimatedSavings / currentCost : 0,
    affectedEvents: positiveCandidates.length,
    affectedTokens,
    candidates: candidates.sort((a, b) => (b.savings ?? -Infinity) - (a.savings ?? -Infinity)),
    rules: [...rulesById.values()].sort((a, b) => a.id.localeCompare(b.id)),
    warnings: [...new Set(warnings)],
  };
}
