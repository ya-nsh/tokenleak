import { expect, test } from 'bun:test';
import type { ProviderData, UsageEvent } from '../types';
import { buildSessionRollups, buildAttributionClusters } from './analytics';
import { buildAgentWasteReport } from './agent-waste';
import { buildReplayReport } from './replay';
import { buildReceipt } from './receipt-lines';
import { clusterPrompts } from './prompt-clusters';
import { cacheHitRate } from './cache-rate';
import { buildMoreStats } from './more';

const range = { since: '2026-03-12', until: '2026-03-12' };
const event = (changes: Partial<UsageEvent> = {}): UsageEvent => ({ provider: 'codex',
  date: range.since, timestamp: `${range.since}T10:00:00Z`, model: 'gpt-5.5',
  inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
  totalTokens: 110, cost: 1, sessionId: 'same-id', ...changes });
function provider(events: UsageEvent[]): ProviderData {
  return { provider: 'codex', displayName: 'Codex', colors: { primary: '#fff', secondary: '#aaa', gradient: ['#fff', '#aaa'] },
    totalTokens: events.reduce((sum, e) => sum + e.totalTokens, 0), totalCost: events.reduce((sum, e) => sum + e.cost, 0),
    events, daily: events.map((e) => ({ ...e, models: [{ ...e }] })) };
}

test('session collisions cannot merge providers or misattribute projects', () => {
  const events = [event({ provider: 'codex', projectId: '/project-a' }), event({ provider: 'claude-code', projectId: '/project-b' })];
  const sessions = buildSessionRollups(events);
  expect(sessions).toHaveLength(2);
  expect(sessions.map((s) => s.sessionId)).toEqual(['same-id', 'same-id']);
  expect(sessions.every((s) => s.totalTokens === 110)).toBe(true);
  const clusters = buildAttributionClusters(events);
  expect(clusters).toHaveLength(2);
  expect(clusters.every((c) => c.tokens === 110 && c.cost === 1)).toBe(true);
  expect(buildReplayReport([provider(events)], range.since).summary.totalSessions).toBe(2);
  expect(buildAgentWasteReport([], events, range).summary.analyzedSessions).toBe(2);
});

test('prompt quantities use submissions while preserving all response costs', () => {
  const events = [event({ prompt: 'Implement this feature', promptId: 'p1' }),
    event({ prompt: 'Implement this feature', promptId: 'p1' }),
    event({ prompt: 'Implement this feature', promptId: 'p2' })];
  expect(clusterPrompts(events)[0]).toMatchObject({ count: 2, totalCost: 3, totalTokens: 330 });
  expect(buildReceipt(events, range).summary.accountedPrompts).toBe(2);
  expect(buildAgentWasteReport([], events, range).signals.some((signal) => signal.kind === 'prompt-repeat')).toBe(false);
  expect(clusterPrompts([...events, event({ provider: 'claude-code', prompt: 'Implement this feature', promptId: 'p1' })])[0]!.count).toBe(3);
});

test('receipt completeness survives overflow, uncaptured prompts, and reported zero cost', () => {
  const unknown = event({ model: 'unknown-model', cost: 0, costSource: 'unpriced', prompt: 'Explain recursive trees' });
  const known = event({ prompt: 'Build the new interface', costSource: 'provider-reported' });
  const receipt = buildReceipt([known, unknown, { ...unknown, prompt: undefined }], range, { topLines: 1 });
  expect(receipt.lines).toHaveLength(1);
  expect(receipt.lines[0]!.costCompleteness?.status).toBe('partial');
  expect(receipt.summary.costCompleteness?.status).toBe('partial');
  expect(receipt.summary.serviceFeesCompleteness?.status).toBe('unknown');
  expect(receipt.summary.total).toBe(1);
  expect(buildReceipt([unknown], range).summary.costCompleteness?.status).toBe('unknown');
  expect(buildReceipt([event({ cost: 0, costSource: 'provider-reported' })], range).summary.costCompleteness?.status).toBe('complete');
});

test('cache creation counts as a miss across totals, replay, and recommendations', () => {
  const data = provider([event({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 100, cacheWriteTokens: 900, totalTokens: 1000 })]);
  expect(cacheHitRate(data.daily)).toBeCloseTo(0.1);
  expect(buildMoreStats([data], range).cacheEconomics.readCoverage).toBeCloseTo(0.1);
  expect(buildReplayReport([data], range.since).flowBlocks[0]!.cacheHitRateTrend[0]).toBeCloseTo(0.1);
  expect(buildAgentWasteReport([data], data.events!, range).signals.some((s) => s.kind === 'cache-miss-heavy')).toBe(true);
});
