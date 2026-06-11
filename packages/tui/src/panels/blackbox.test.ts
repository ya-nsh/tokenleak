import { describe, expect, test } from 'bun:test';
import type { ProviderData, UsageEvent } from '@tokenleak/core';
import { buildBlackBoxTrace } from '@tokenleak/core';
import { createInitialState } from '../lib/state.js';
import {
  createBlackBoxPanel,
  getBlackBoxFocusableNodeIds,
  nextBlackBoxFocusMode,
} from './blackbox.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectTextContent(node: unknown): string[] {
  if (!isRecord(node)) return [];
  const props = node['props'];
  const ownContent = isRecord(props) && typeof props['content'] === 'string' ? [props['content']] : [];
  const children = Array.isArray(node['children'])
    ? node['children'].flatMap((child) => collectTextContent(child))
    : [];
  return [...ownContent, ...children];
}

function event(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    provider: 'codex',
    timestamp: '2026-04-25T10:00:00.000Z',
    date: '2026-04-25',
    model: 'gpt-5.4',
    inputTokens: 30_000,
    outputTokens: 800,
    cacheReadTokens: 0,
    cacheWriteTokens: 1_000,
    totalTokens: 31_800,
    cost: 1.2,
    sessionId: 'session-a',
    projectId: '/Users/alice/work/tokenleak',
    repoRoot: '/Users/alice/work/tokenleak',
    prompt: 'please debug /Users/alice/work/tokenleak/packages/core/src/index.ts and summarize',
    ...overrides,
  };
}

function provider(events: UsageEvent[]): ProviderData {
  return {
    provider: 'codex',
    displayName: 'Codex',
    daily: [],
    totalTokens: events.reduce((sum, e) => sum + e.totalTokens, 0),
    totalCost: events.reduce((sum, e) => sum + e.cost, 0),
    colors: { primary: '#00ffff', secondary: '#ff00ff', gradient: ['#00ffff', '#ff00ff'] },
    events,
  };
}

describe('createBlackBoxPanel', () => {
  test('renders a useful empty state', () => {
    const state = createInitialState();
    const text = collectTextContent(createBlackBoxPanel(state, null, 78)).join('\n');

    expect(text).toContain('Black Box');
    expect(text).toContain('No event-level sessions found');
  });

  test('renders graph, inspector, hot path, and controls for a populated trace', () => {
    const state = createInitialState();
    const trace = buildBlackBoxTrace(
      [provider([
        event({ timestamp: '2026-04-25T10:00:00.000Z', model: 'gpt-5.4' }),
        event({ timestamp: '2026-04-25T10:05:00.000Z', model: 'gpt-5-mini', cost: 0.8 }),
      ])],
      { since: '2026-04-01', until: '2026-04-30' },
    );

    const text = collectTextContent(createBlackBoxPanel(state, trace, 110)).join('\n');

    expect(text).toContain('BLACK BOX TRACE BUS');
    expect(text).toContain('INSPECTOR');
    expect(text).toContain('Hot path:');
    expect(text).toContain('j/k node');
  });

  test('focus helpers expose lanes and cycle predictably', () => {
    const trace = buildBlackBoxTrace(
      [provider([
        event({ timestamp: '2026-04-25T10:00:00.000Z', model: 'gpt-5.4' }),
        event({ timestamp: '2026-04-25T10:05:00.000Z', model: 'gpt-5-mini' }),
      ])],
      { since: '2026-04-01', until: '2026-04-30' },
    );

    expect(getBlackBoxFocusableNodeIds(trace, 'all').length).toBeGreaterThan(0);
    expect(getBlackBoxFocusableNodeIds(trace, 'churn').length).toBeGreaterThan(0);
    expect(nextBlackBoxFocusMode('all')).toBe('costly-path');
  });
});
