import { describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { ModelEfficiencyEntry, ProjectDrilldownEntry, SessionDrilldownEntry } from '@tokenleak/core';
import { createModelEfficiencyPanel, createTopSessionsPanel } from './matrix-efficiency';
import { createTopProjectsPanel } from './matrix-sessions';

const PANEL_WIDTH = 70;
const PANEL_HEIGHT = 16;

/** Renders one panel alone and returns its text frame. */
async function renderPanel(panel: ReturnType<typeof createModelEfficiencyPanel>): Promise<string> {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
  try {
    renderer.root.add(panel);
    await renderOnce();
    return captureCharFrame();
  } finally {
    renderer.destroy();
  }
}

function efficiency(overrides: Partial<ModelEfficiencyEntry>): ModelEfficiencyEntry {
  return {
    model: 'claude-haiku-5-5',
    eventCount: 10,
    totalTokens: 1_000_000,
    inputTokens: 1_000,
    outputTokens: 682_110,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0.17,
    outputInputRatio: 682.11,
    outputPerDollar: 1,
    cacheCoverage: 0.59,
    costPer1MTotal: 0.1682,
    score: 0.67,
    scoreBreakdown: { outputPerDollar: 1, outputInputRatio: 1, cacheCoverage: 1 },
    ...overrides,
  };
}

function session(overrides: Partial<SessionDrilldownEntry>): SessionDrilldownEntry {
  return {
    sessionId: 's1',
    label: 'session one',
    provider: 'claude-code',
    projectId: '/Users/me/work/headroom',
    repoRoot: '/Users/me/work/headroom',
    directory: '.',
    start: '2026-11-01T10:00:00Z',
    end: '2026-11-01T12:00:00Z',
    durationMs: 7_200_000,
    eventCount: 4,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 440_000_000,
    cost: 137.11,
    topModels: [],
    ...overrides,
  };
}

function project(overrides: Partial<ProjectDrilldownEntry>): ProjectDrilldownEntry {
  return {
    projectId: '/Users/me/work/loopcraft',
    repoRoot: '/Users/me/work/loopcraft',
    directory: '.',
    sessionCount: 3,
    activeDays: 2,
    streak: 2,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 2_900_000_000,
    cost: 812.5,
    topModels: [],
    topSessions: [],
    ...overrides,
  };
}

/** The frame line that contains `text`. */
function lineWith(frame: string, text: string): string {
  const line = frame.split('\n').find((candidate) => candidate.includes(text));
  if (line === undefined) throw new Error(`no line contains ${JSON.stringify(text)}:\n${frame}`);
  return line;
}

describe('Matrix model efficiency table', () => {
  test('keeps $/M and O/I apart when O/I is large', async () => {
    const frame = await renderPanel(createModelEfficiencyPanel({ method: 'test', rankings: [efficiency({})], ineligibleModels: [] }));
    const row = lineWith(frame, 'claude-haiku-5-5');
    expect(row).toMatch(/\$0\.17\s+682\s+59%/);
    expect(row).not.toContain('$0.1682');
  });

  test('keeps small ratios at two decimals', async () => {
    const frame = await renderPanel(
      createModelEfficiencyPanel({ method: 'test', rankings: [efficiency({ outputInputRatio: 0.48, costPer1MTotal: 3.2 })], ineligibleModels: [] }),
    );
    expect(lineWith(frame, 'claude-haiku-5-5')).toMatch(/\$3\.20\s+0\.48\s+59%/);
  });

  test('shows the empty state without rankings', async () => {
    const frame = await renderPanel(createModelEfficiencyPanel({ method: 'test', rankings: [], ineligibleModels: [] }));
    expect(frame).toContain('Insufficient data for efficiency ranking');
  });
});

describe('Matrix top sessions table', () => {
  test('names repo-root sessions after the repo instead of "."', async () => {
    const frame = await renderPanel(createTopSessionsPanel([session({})]));
    const row = lineWith(frame, '1.');
    expect(row).toContain('headroom');
    expect(row).not.toMatch(/1\.\s+\.\s/);
  });

  test('keeps a long duration apart from the cost', async () => {
    const frame = await renderPanel(createTopSessionsPanel([session({ cost: 1_234.56, durationMs: 897_300_000 })]));
    expect(lineWith(frame, 'headroom')).toMatch(/\$1,235\s+249h 15m/);
  });

  test('shows the empty state without sessions', async () => {
    expect(await renderPanel(createTopSessionsPanel([]))).toContain('No session data available');
  });
});

describe('Matrix top projects table', () => {
  test('names repo-root projects after the repo instead of "."', async () => {
    const frame = await renderPanel(createTopProjectsPanel([project({})]));
    expect(lineWith(frame, '1.')).toContain('loopcraft');
  });

  test('shows the empty state without projects', async () => {
    expect(await renderPanel(createTopProjectsPanel([]))).toContain('No project data available');
  });
});
