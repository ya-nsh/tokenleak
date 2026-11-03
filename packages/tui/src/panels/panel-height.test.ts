import { describe, expect, test } from 'bun:test';
import type {
  NutritionRepoSummary,
  NutritionReport,
  RoutingSimulationCandidate,
  RoutingSimulationReport,
  SavingsRecommendation,
  SavingsReport,
} from '@tokenleak/core';
import { createInitialState } from '../lib/state.js';
import { createAdvisorPanel } from './advisor.js';
import { createNutritionPanel } from './nutrition.js';
import { createSimulatorPanel } from './simulator.js';
import { createWastePanel } from './waste.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Terminal rows a panel needs: a Text is one row, a row-direction Box is one
 * row, and a column Box stacks its children plus two rows for a border.
 */
function countRows(node: unknown): number {
  if (!isRecord(node)) return 0;
  const props = isRecord(node['props']) ? node['props'] : {};
  const children = Array.isArray(node['children']) ? node['children'] : [];
  if (children.length === 0) return 1;
  if (props['flexDirection'] === 'row') return 1;
  const border = props['borderStyle'] ? 2 : 0;
  return border + children.reduce((sum: number, child: unknown) => sum + countRows(child), 0);
}

const HEIGHTS = [16, 22, 30, 33, 34, 40];

function recommendation(index: number): SavingsRecommendation {
  return {
    kind: 'prompt-repeat',
    category: 'session',
    title: `Repeated prompt cluster ${index}`,
    severity: 'high',
    confidence: 'high',
    estimatedSavings: 10,
    monthlySavings: 30,
    evidence: { eventCount: 5, tokens: 1_000, cost: 30, reason: 'a long reason '.repeat(20) },
    recipes: [{ title: 'Break the retry loop', detail: 'detail' }],
  };
}

function savingsReport(count: number): SavingsReport {
  return {
    method: 'test',
    dateRange: { since: '2026-10-01', until: '2026-10-30' },
    summary: {
      totalRecommendations: count,
      highSeverity: count,
      currentCost: 300,
      currentMonthlyCost: 300,
      estimatedSavings: 10,
      monthlySavings: 30,
      analyzedDays: 30,
      analyzedEvents: 100,
      analyzedSessions: 10,
      // Below full coverage, so the Advisor also shows its pricing-gap line.
      pricedTokenShare: 0.5,
      unpricedModels: ['mystery'],
    },
    recommendations: Array.from({ length: count }, (_, index) => recommendation(index)),
    warnings: ['A warning long enough to wrap onto a second line. '.repeat(3)],
  };
}

function candidate(index: number): RoutingSimulationCandidate {
  return {
    ruleId: 'premium-short-output',
    eventId: `event-${index}`,
    provider: 'codex',
    fromModel: 'gpt-5.5',
    toModel: 'gpt-5-mini',
    currentCost: 1,
    simulatedCost: 0.5,
    savings: 0.5,
    tokens: 12_000,
    confidence: 'medium',
    reasons: ['Premium model with short output', 'cache-aware target pricing'],
  };
}

function routingReport(count: number): RoutingSimulationReport {
  return {
    method: 'test',
    dateRange: { since: '2026-10-01', until: '2026-10-30' },
    strategy: 'conservative',
    currentCost: 60,
    simulatedCost: 30,
    estimatedSavings: 30,
    estimatedSavingsPercent: 0.5,
    affectedEvents: count,
    affectedTokens: 12_000 * count,
    candidates: Array.from({ length: count }, (_, index) => candidate(index)),
    rules: [],
    warnings: ['No downgrade path for gpt-5.', 'Savings are calculated on the priced subset only.'],
  };
}

function repo(index: number): NutritionRepoSummary {
  return {
    repoRoot: `/work/repo-${index}`,
    label: `repo-${index}`,
    providers: ['codex'],
    models: ['gpt-5.5'],
    sessions: 3,
    tokens: 1_000_000,
    cost: 10,
    commits: 0,
    changedFiles: 0,
    changedLines: 0,
    tokensPerCommit: null,
    costPerCommit: null,
    tokensPerChangedLine: null,
    costPerChangedLine: null,
  };
}

function nutritionReport(count: number): NutritionReport {
  return {
    method: 'test',
    dateRange: { since: '2026-10-01', until: '2026-10-30' },
    totals: {
      tokens: 1_000_000 * count,
      cost: 10 * count,
      commits: 0,
      changedFiles: 0,
      changedLines: 0,
      tokensPerCommit: null,
      costPerCommit: null,
      tokensPerChangedLine: null,
      costPerChangedLine: null,
    },
    repos: Array.from({ length: count }, (_, index) => repo(index)),
    // Repos without commits make the Git-signal notice add its detail line.
    missingOutcomeRepos: ['/work/repo-0'],
  };
}

describe('paged panels fit the rows they are given', () => {
  for (const height of HEIGHTS) {
    test(`at ${height} rows`, () => {
      const state = createInitialState();
      // Mid-list, so both scroll indicators show.
      state.advisorScrollOffset = 1;
      state.nutritionScrollOffset = 1;
      const panels = {
        advisor: createAdvisorPanel(state, savingsReport(30), height),
        waste: createWastePanel(savingsReport(30), 1, 78, height),
        simulator: createSimulatorPanel(routingReport(30), 1, 78, height),
        nutrition: createNutritionPanel(state, nutritionReport(30), height),
      };
      for (const [name, panel] of Object.entries(panels)) {
        const rows = countRows(panel);
        // A page always keeps one item, so only very small terminals may overflow.
        if (height >= 22) expect({ name, rows }).toEqual({ name, rows: Math.min(rows, height) });
      }
    });
  }

  test('the AI ROI table narrows to fit 100 columns instead of wrapping', () => {
    const lines: string[] = [];
    const collect = (node: unknown): void => {
      if (!isRecord(node)) return;
      const props = isRecord(node['props']) ? node['props'] : {};
      if (typeof props['content'] === 'string') lines.push(props['content']);
      if (Array.isArray(node['children'])) node['children'].forEach(collect);
    };
    // 100 columns minus the panel border and padding.
    collect(createNutritionPanel(createInitialState(), nutritionReport(3), 34, 96));
    const table = lines.filter((line) => /^[│┌├└]/.test(line));
    expect(table.length).toBeGreaterThan(0);
    for (const line of table) expect(line.length).toBeLessThanOrEqual(96);
    expect(table.some((line) => line.includes('/work/repo-0'))).toBe(true);
  });

  test('taller terminals show more items, up to each panel’s maximum', () => {
    const state = createInitialState();
    const short = countRows(createWastePanel(savingsReport(30), 0, 78, 22));
    const tall = countRows(createWastePanel(savingsReport(30), 0, 78, 200));
    expect(tall).toBeGreaterThan(short);
    expect(countRows(createAdvisorPanel(state, savingsReport(30), 200))).toBe(
      countRows(createAdvisorPanel(state, savingsReport(30))),
    );
  });
});
