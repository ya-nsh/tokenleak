import { describe, expect, test } from 'bun:test';
import { redactPromptsForExport, redactSavingsReportForExport } from './export-privacy';
import type { SavingsReport, TokenleakOutput, UsageEvent } from './types';

const SECRET = 'here is my API key sk-live-123';

function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: '2026-10-01T00:00:00.000Z',
    date: '2026-10-01',
    model: 'claude-opus-5-5',
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2,
    cost: 0,
    prompt: SECRET,
    promptId: 'user:1',
    ...overrides,
  };
}

function savingsReport(): SavingsReport {
  return {
    method: 'x',
    dateRange: { since: '2026-10-01', until: '2026-10-01' },
    summary: {
      totalRecommendations: 2,
      highSeverity: 0,
      currentCost: 0,
      currentMonthlyCost: 0,
      estimatedSavings: null,
      monthlySavings: null,
      analyzedDays: 1,
      analyzedEvents: 2,
      analyzedSessions: 1,
      pricedTokenShare: 1,
      unpricedModels: [],
    },
    recommendations: [
      {
        kind: 'prompt-repeat',
        category: 'session',
        title: 'Repeated prompt cluster',
        severity: 'low',
        confidence: 'low',
        estimatedSavings: null,
        monthlySavings: null,
        evidence: { eventCount: 4, tokens: 10, cost: 0, reason: `4 similar prompts clustered around "${SECRET}".` },
        recipes: [],
      },
      {
        kind: 'context-drag',
        category: 'session',
        title: 'Context keeps growing',
        severity: 'medium',
        confidence: 'high',
        estimatedSavings: null,
        monthlySavings: null,
        evidence: { eventCount: 1, tokens: 10, cost: 0, reason: 'Requests grew from 10K to 300K tokens.' },
        recipes: [],
      },
    ],
    warnings: [],
  };
}

function output(): TokenleakOutput {
  return {
    schemaVersion: 1,
    generated: '2026-10-02T00:00:00.000Z',
    dateRange: { since: '2026-10-01', until: '2026-10-01' },
    providers: [
      {
        provider: 'claude-code',
        displayName: 'Claude Code',
        daily: [],
        totalTokens: 2,
        totalCost: 0,
        colors: { primary: '#000', secondary: '#000', gradient: ['#000', '#000'] },
        events: [event(), event({ prompt: undefined })],
      },
      {
        provider: 'codex',
        displayName: 'Codex',
        daily: [],
        totalTokens: 0,
        totalCost: 0,
        colors: { primary: '#000', secondary: '#000', gradient: ['#000', '#000'] },
      },
    ],
    aggregated: {} as TokenleakOutput['aggregated'],
    optimization: { savings: savingsReport() },
  };
}

describe('redactPromptsForExport', () => {
  test('removes every prompt and every quoted prompt', () => {
    const redacted = redactPromptsForExport(output());
    expect(JSON.stringify(redacted)).not.toContain('sk-live-123');
  });

  test('keeps prompt ids so turns can still be grouped', () => {
    const redacted = redactPromptsForExport(output());
    expect(redacted.providers[0]!.events![0]!.promptId).toBe('user:1');
    expect('prompt' in redacted.providers[0]!.events![0]!).toBe(false);
  });

  test('says how to get prompts back in savings evidence', () => {
    const recommendation = redactPromptsForExport(output()).optimization!.savings!.recommendations[0]!;
    expect(recommendation.evidence.reason).toBe(
      '4 similar prompts clustered (prompt text omitted from export; pass --include-prompts to keep it).',
    );
  });

  test('leaves non-prompt recommendations and providers without events untouched', () => {
    const original = output();
    const redacted = redactPromptsForExport(original);
    expect(redacted.optimization!.savings!.recommendations[1]).toBe(
      original.optimization!.savings!.recommendations[1],
    );
    expect(redacted.providers[1]).toBe(original.providers[1]);
  });

  test('never mutates the input', () => {
    const original = output();
    redactPromptsForExport(original);
    expect(original.providers[0]!.events![0]!.prompt).toBe(SECRET);
  });

  test('handles output without optimization data', () => {
    const { optimization: _optimization, ...rest } = output();
    void _optimization;
    expect(redactPromptsForExport(rest).optimization).toBeUndefined();
  });
});

describe('redactSavingsReportForExport', () => {
  test('redacts only prompt-repeat evidence', () => {
    const redacted = redactSavingsReportForExport(savingsReport());
    expect(redacted.recommendations[0]!.evidence.reason).not.toContain(SECRET);
    expect(redacted.recommendations[1]!.evidence.reason).toBe('Requests grew from 10K to 300K tokens.');
  });
});
