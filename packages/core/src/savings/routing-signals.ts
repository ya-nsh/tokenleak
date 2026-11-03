import type { RoutingSimulationCandidate, RoutingSimulationReport } from '../types';
import { formatUsd } from '../format';
import { confidenceFor, recipe, severityFor, type Finding } from './shared';

interface RouteGroup {
  provider: string;
  fromModel: string;
  toModel: string;
  candidates: RoutingSimulationCandidate[];
}

function groupRoutes(candidates: readonly RoutingSimulationCandidate[]): RouteGroup[] {
  const groups = new Map<string, RouteGroup>();
  for (const candidate of candidates) {
    if ((candidate.savings ?? 0) <= 0) continue;
    const key = `${candidate.provider}\u0000${candidate.fromModel}\u0000${candidate.toModel}`;
    const group = groups.get(key) ?? {
      provider: candidate.provider,
      fromModel: candidate.fromModel,
      toModel: candidate.toModel,
      candidates: [],
    };
    group.candidates.push(candidate);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * One finding per (provider, model, cheaper model) route the simulator
 * re-priced with a saving. Savings are the simulator's per-event re-pricing,
 * not a flat guess.
 */
export function detectRoutingFindings(routing: RoutingSimulationReport): Finding[] {
  return groupRoutes(routing.candidates).map((group): Finding => {
    const { candidates } = group;
    const savings = candidates.reduce((sum, candidate) => sum + (candidate.savings ?? 0), 0);
    const currentCost = candidates.reduce((sum, candidate) => sum + candidate.currentCost, 0);
    const tokens = candidates.reduce((sum, candidate) => sum + candidate.tokens, 0);
    const lowConfidence = candidates.filter((candidate) => candidate.confidence === 'low').length;
    const rules = [...new Set(candidates.flatMap((candidate) => candidate.reasons.slice(0, 1)))];
    return {
      kind: 'model-routing',
      title: `Route small tasks from ${group.fromModel} to ${group.toModel}`,
      severity: severityFor(savings),
      confidence: confidenceFor(candidates.length, lowConfidence * 2 > candidates.length),
      estimatedSavings: savings,
      evidence: {
        provider: group.provider,
        model: group.fromModel,
        eventCount: candidates.length,
        tokens,
        cost: currentCost,
        reason:
          `${candidates.length.toLocaleString('en-US')} events (${rules.join(', ').toLowerCase()}) cost ${formatUsd(currentCost)} ` +
          `on ${group.fromModel} and would have cost ${formatUsd(currentCost - savings)} on ${group.toModel}.`,
      },
      recipes: [
        recipe(
          'Send short lookups and small fixes to the cheaper model',
          `Keep ${group.fromModel} for planning and hard edits; use ${group.toModel} for routine explanations, grep-style lookups, and small rewrites.`,
          'tokenleak simulate-routing',
        ),
      ],
    };
  });
}
