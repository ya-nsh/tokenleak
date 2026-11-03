import { describe, expect, test } from 'bun:test';
import type { SavingsRecommendation, SavingsReport } from '@tokenleak/core';
import { createInitialState } from '../lib/state.js';
import { ADVISOR_LINES_PER_ITEM, ADVISOR_VISIBLE_ITEMS, createAdvisorPanel } from './advisor.js';

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

function recommendation(index: number): SavingsRecommendation {
  return {
    kind: 'prompt-repeat',
    category: 'session',
    title: `Repeated prompt cluster ${index}`,
    severity: 'high',
    confidence: 'high',
    estimatedSavings: 10,
    monthlySavings: 30,
    evidence: {
      eventCount: 5,
      tokens: 1_000,
      cost: 30,
      reason: `${index} ${'similar prompts clustered around a very long pasted request '.repeat(4)}`,
    },
    recipes: [{ title: 'Break the retry loop', detail: 'A long recipe detail. '.repeat(10) }],
  };
}

function report(count: number): SavingsReport {
  return {
    method: 'test',
    dateRange: { since: '2026-10-01', until: '2026-10-30' },
    summary: {
      totalRecommendations: count,
      highSeverity: count,
      currentCost: 300,
      currentMonthlyCost: 300,
      estimatedSavings: 10 * count,
      monthlySavings: 30 * count,
      analyzedDays: 30,
      analyzedEvents: 100,
      analyzedSessions: 10,
      pricedTokenShare: 1,
      unpricedModels: [],
    },
    recommendations: Array.from({ length: count }, (_, index) => recommendation(index)),
    warnings: [],
  };
}

describe('createAdvisorPanel', () => {
  test('a page of long recommendations fits its line budget', () => {
    const lines = collectTextContent(createAdvisorPanel(createInitialState(), report(12)));
    // Title, the summary row's five text runs, blank, section header and one scroll indicator.
    const chrome = 1 + 5 + 1 + 1 + 1;
    expect(lines.length).toBeLessThanOrEqual(
      chrome + ADVISOR_VISIBLE_ITEMS * ADVISOR_LINES_PER_ITEM,
    );
    expect(lines).toContain('  7 more below');
  });

  test('leaves recipes to the Waste view', () => {
    const text = collectTextContent(createAdvisorPanel(createInitialState(), report(1))).join('\n');
    expect(text).not.toContain('Recipe:');
    // The saving stays on the title line however long the reason is.
    expect(text).toContain('Repeated prompt cluster 0  $30.00/mo  [HIGH]');
  });

  test('says there is nothing to do when the report is empty', () => {
    const text = collectTextContent(createAdvisorPanel(createInitialState(), report(0))).join('\n');
    expect(text).toContain('No optimization opportunities detected');
  });
});
