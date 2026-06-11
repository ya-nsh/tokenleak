import { describe, expect, test } from 'bun:test';
import { buildBlackBoxTrace } from '@tokenleak/core';
import type { ProviderData } from '@tokenleak/core';
import { generateBlackBoxLiveHtml } from '../blackbox-live-template';

function provider(): ProviderData {
  return {
    provider: 'codex',
    displayName: 'Codex',
    colors: { primary: '#67e8f9', secondary: '#60a5fa', gradient: ['#67e8f9', '#60a5fa'] },
    totalTokens: 52_000,
    totalCost: 1.9,
    daily: [],
    events: [
      {
        provider: 'codex',
        timestamp: '2026-04-10T12:00:00.000Z',
        date: '2026-04-10',
        model: 'gpt-5',
        inputTokens: 39_000,
        outputTokens: 1_100,
        cacheReadTokens: 0,
        cacheWriteTokens: 2_400,
        totalTokens: 42_500,
        cost: 1.6,
        sessionId: 'session-a',
        projectId: '/Users/example/tokenleak',
        repoRoot: '/Users/example/tokenleak',
        prompt: 'Fix /Users/example/tokenleak/src/private.ts using sk_exampleSecretValue123456789 and email me@example.com',
      },
      {
        provider: 'codex',
        timestamp: '2026-04-10T12:03:00.000Z',
        date: '2026-04-10',
        model: 'gpt-5-mini',
        inputTokens: 8_000,
        outputTokens: 1_500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 9_500,
        cost: 0.3,
        sessionId: 'session-a',
        projectId: '/Users/example/tokenleak',
        repoRoot: '/Users/example/tokenleak',
        prompt: 'Show the graph view',
      },
    ],
  };
}

describe('generateBlackBoxLiveHtml', () => {
  test('renders a self-contained interactive graph shell', () => {
    const trace = buildBlackBoxTrace([provider()], { since: '2026-04-01', until: '2026-04-30' });
    const html = generateBlackBoxLiveHtml(trace);

    expect(html).toContain('Tokenleak Black Box');
    expect(html).toContain('<svg id="graph"');
    expect(html).toContain('click node expands');
    expect(html).toContain('data-focus="waste"');
    expect(html).toContain('reveal all');
    expect(html).toContain('[path]');
    expect(html).toContain('[email]');
    expect(html).not.toContain('sk_exampleSecretValue123456789');
  });

  test('renders the empty state when no event trace exists', () => {
    const trace = buildBlackBoxTrace([], { since: '2026-04-01', until: '2026-04-30' });
    const html = generateBlackBoxLiveHtml(trace);

    expect(html).toContain('No event graph available');
    expect(html).toContain('No trace targets found.');
  });
});
