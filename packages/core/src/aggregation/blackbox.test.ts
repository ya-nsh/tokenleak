import { describe, expect, test } from 'bun:test';
import type { ProviderData, UsageEvent } from '../types';
import { buildBlackBoxTrace, redactPromptSnippet } from './blackbox';

function event(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    provider: 'codex',
    timestamp: '2026-04-25T10:00:00.000Z',
    date: '2026-04-25',
    model: 'gpt-5.4',
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1_500,
    cost: 0.05,
    sessionId: 'session-a',
    projectId: '/Users/alice/work/tokenleak',
    repoRoot: '/Users/alice/work/tokenleak',
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

describe('buildBlackBoxTrace', () => {
  test('returns an empty trace when no events exist in the window', () => {
    const trace = buildBlackBoxTrace([], { since: '2026-04-01', until: '2026-04-30' });

    expect(trace.target).toBeNull();
    expect(trace.nodes).toEqual([]);
    expect(trace.warnings).toContain('No event-level sessions were found in this window.');
  });

  test('selects the most recent session target and exposes alternate targets', () => {
    const trace = buildBlackBoxTrace(
      [provider([
        event({ sessionId: 'older', timestamp: '2026-04-24T10:00:00.000Z', date: '2026-04-24' }),
        event({ sessionId: 'latest', timestamp: '2026-04-25T10:00:00.000Z', date: '2026-04-25' }),
      ])],
      { since: '2026-04-01', until: '2026-04-30' },
    );

    expect(trace.target?.sessionId).toBe('latest');
    expect(trace.targets.map((target) => target.sessionId)).toEqual(['latest', 'older']);
  });

  test('marks high-cost events as hot path nodes', () => {
    const trace = buildBlackBoxTrace(
      [provider([
        event({ timestamp: '2026-04-25T10:00:00.000Z', totalTokens: 1_000, cost: 0.01 }),
        event({ timestamp: '2026-04-25T10:01:00.000Z', totalTokens: 150_000, cost: 6 }),
      ])],
      { since: '2026-04-01', until: '2026-04-30' },
    );

    const hotNodes = trace.nodes.filter((node) => trace.hotPathNodeIds.includes(node.id));
    expect(hotNodes.some((node) => node.kind === 'event' && node.severity === 'high')).toBe(true);
  });

  test('creates model churn and cache marker nodes', () => {
    const trace = buildBlackBoxTrace(
      [provider([
        event({ timestamp: '2026-04-25T10:00:00.000Z', model: 'gpt-5.4', inputTokens: 20_000, outputTokens: 400, totalTokens: 20_400 }),
        event({ timestamp: '2026-04-25T10:02:00.000Z', model: 'gpt-5-mini', inputTokens: 10_000, outputTokens: 300, totalTokens: 10_300 }),
      ])],
      { since: '2026-04-01', until: '2026-04-30' },
    );

    expect(trace.nodes.some((node) => node.kind === 'model-switch')).toBe(true);
    expect(trace.nodes.some((node) => node.kind === 'cache')).toBe(true);
    expect(trace.nodes.some((node) => node.kind === 'waste')).toBe(true);
  });

  test('adds optional Git outcome nodes when matching signals are provided', () => {
    const trace = buildBlackBoxTrace(
      [provider([event({})])],
      { since: '2026-04-01', until: '2026-04-30' },
      {
        outcomeSignals: [
          {
            repoRoot: '/Users/alice/work/tokenleak',
            commits: 2,
            changedFiles: 4,
            changedLines: 120,
          },
        ],
      },
    );

    expect(trace.nodes.some((node) => node.kind === 'outcome')).toBe(true);
    expect(trace.summary.gitOutcomeSignals).toBe(1);
  });
});

describe('redactPromptSnippet', () => {
  test('redacts paths, emails, secrets, and truncates long prompts', () => {
    const prompt = `email me@example.com and inspect /Users/alice/private/repo/src/file.ts with sk_secretsecretsecretsecret ${'x'.repeat(100)}`;
    const redacted = redactPromptSnippet(prompt);

    expect(redacted).toContain('[email]');
    expect(redacted).toContain('[path]');
    expect(redacted).toContain('[secret]');
    expect(redacted!.length).toBeLessThanOrEqual(78);
  });
});
