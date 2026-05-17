import { describe, expect, test } from 'bun:test';
import type {
  AgentWasteReport,
  AgentWasteSignal,
  RoutingSimulationCandidate,
  RoutingSimulationReport,
} from '@tokenleak/core';
import { createWastePanel } from './waste.js';
import { createSimulatorPanel } from './simulator.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectTextContent(node: unknown): string[] {
  if (!isRecord(node)) return [];
  const props = node['props'];
  const ownContent =
    isRecord(props) && typeof props['content'] === 'string' ? [props['content']] : [];
  const children = Array.isArray(node['children'])
    ? node['children'].flatMap((child) => collectTextContent(child))
    : [];
  return [...ownContent, ...children];
}

function wasteSignal(
  title: string,
  reason: string,
  recipeTitle: string,
  cost: number,
): AgentWasteSignal {
  return {
    kind: title === 'Repeated prompt cluster' ? 'prompt-repeat' : 'context-drag',
    title,
    severity: 'high',
    confidence: 'high',
    estimatedSavings: cost / 2,
    evidence: {
      eventCount: 12,
      tokens: 24_200_000,
      cost,
      reason,
      sessionId: 'session-1',
    },
    recipes: [{ title: recipeTitle, detail: 'Try a more focused next step.' }],
  };
}

function wasteReport(): AgentWasteReport {
  const signals = [
    wasteSignal(
      'Repeated prompt cluster',
      '191 similar prompts clustered around "# Optimization Intelligence Plan PLEASE IMPLEMENT THIS PLAN with many extra words".',
      'Break the retry loop',
      8,
    ),
    wasteSignal(
      'High context drag',
      'Input tokens are 14.5x output tokens in this session.',
      'Start a compact follow-up session',
      6,
    ),
    wasteSignal(
      'Repeated prompt cluster',
      '181 similar prompts clustered around "# Thread handoff and merge the pending branch".',
      'Break the retry loop',
      4,
    ),
  ];
  return {
    method: 'test',
    dateRange: { since: '2026-05-10', until: '2026-05-16' },
    summary: {
      totalSignals: signals.length,
      highSeverity: signals.length,
      estimatedSavings: 9,
      analyzedEvents: 200,
      analyzedSessions: 8,
    },
    signals,
    warnings: [],
  };
}

function scrollableWasteReport(): AgentWasteReport {
  const report = wasteReport();
  const extra = Array.from({ length: 7 }, (_, index) =>
    wasteSignal(
      index % 2 === 0 ? 'High context drag' : 'Repeated prompt cluster',
      index % 2 === 0
        ? `Input tokens are ${10 + index}.0x output tokens in this session.`
        : `${120 + index} similar prompts clustered around "# Extra prompt ${index}".`,
      index % 2 === 0 ? 'Start a compact follow-up session' : 'Break the retry loop',
      1 + index,
    ),
  );
  const signals = [...report.signals, ...extra];
  return {
    ...report,
    signals,
    summary: {
      ...report.summary,
      totalSignals: signals.length,
      highSeverity: signals.length,
    },
  };
}

function candidate(index: number, savings: number): RoutingSimulationCandidate {
  return {
    ruleId: 'premium-short-output',
    eventId: `event-${index}`,
    provider: 'codex',
    fromModel: 'gpt-5.5',
    toModel: 'gpt-5-mini',
    currentCost: 1,
    simulatedCost: 1 - savings,
    savings,
    tokens: 12_000,
    confidence: 'medium',
    reasons: ['Premium model with short output', 'cache-aware target pricing'],
  };
}

function routingReport(): RoutingSimulationReport {
  const candidates = [candidate(1, 0.75), candidate(2, 0.5)];
  return {
    method: 'test',
    dateRange: { since: '2026-05-10', until: '2026-05-16' },
    strategy: 'conservative',
    currentCost: 61.38,
    simulatedCost: 6.5,
    estimatedSavings: 54.88,
    estimatedSavingsPercent: 0.894,
    affectedEvents: 656,
    affectedTokens: 73_600_000,
    candidates,
    rules: [],
    warnings: ['No downgrade path for gpt-5.'],
  };
}

function scrollableRoutingReport(): RoutingSimulationReport {
  const candidates = Array.from({ length: 10 }, (_, index) => candidate(index + 1, 0.75 - index / 100));
  return {
    ...routingReport(),
    candidates,
  };
}

describe('optimization TUI panels', () => {
  test('waste panel uses stable labels and hides raw prompt fragments', () => {
    const lines = collectTextContent(createWastePanel(wasteReport(), 0, 56));
    const text = lines.join('\n');

    expect(text).toContain('Repeated similar asks');
    expect(text).toContain('Too much context');
    expect(text).toContain('Change approach');
    expect(text).toContain('Start fresh');
    expect(text).not.toContain('# Opt');
    expect(text).not.toContain('# Thr');
    expect(lines.every((line) => line.length <= 56)).toBe(true);
  });

  test('waste panel honors scroll offset', () => {
    const report = scrollableWasteReport();
    const firstPage = collectTextContent(createWastePanel(report, 0, 70)).join('\n');
    const secondPage = collectTextContent(createWastePanel(report, 1, 70)).join('\n');

    expect(firstPage).toContain('191 similar asks');
    expect(secondPage).not.toContain('191 similar asks');
    expect(secondPage).toContain('Too much context');
  });

  test('simulator panel explains routing in action words', () => {
    const lines = collectTextContent(createSimulatorPanel(routingReport(), 0, 72));
    const text = lines.join('\n');

    expect(text).toContain('Actual spend');
    expect(text).toContain('Estimated with routing');
    expect(text).toContain('Could reroute');
    expect(text).toContain('Use gpt-5-mini instead of gpt-5.5 for small answers');
    expect(text).toContain('Save about $0.75 on this event');
    expect(text).toContain('confidence: medium');
    expect(text).not.toContain('Premium model with short output');
    expect(text).not.toContain('cache-aware target pricing');
    expect(text).not.toContain('[medium]');
    expect(lines.every((line) => line.length <= 72)).toBe(true);
  });

  test('simulator panel honors scroll offset', () => {
    const report = scrollableRoutingReport();
    const firstPage = collectTextContent(createSimulatorPanel(report, 0, 72)).join('\n');
    const secondPage = collectTextContent(createSimulatorPanel(report, 1, 72)).join('\n');

    expect(firstPage).toContain('Save about $0.75');
    expect(secondPage).not.toContain('Save about $0.75');
    expect(secondPage).toContain('Save about $0.74');
  });
});
