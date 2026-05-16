import { describe, expect, test } from 'bun:test';
import type { ReplayReport, UsageEvent, FlowBlock } from '@tokenleak/core';
import { createReplayPanel } from './replay';
import type { ReplayPlaybackView } from './replay';
import { computePlaybackSummary } from '../lib/replay-playback';

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

function ev(timestamp: string, model: string, totalTokens: number, cost: number): UsageEvent {
  return {
    provider: 'codex',
    timestamp,
    date: timestamp.slice(0, 10),
    model,
    inputTokens: Math.round(totalTokens * 0.7),
    outputTokens: Math.round(totalTokens * 0.2),
    cacheReadTokens: Math.round(totalTokens * 0.08),
    cacheWriteTokens: Math.round(totalTokens * 0.02),
    totalTokens,
    cost,
  };
}

function block(blockIndex: number, start: string, end: string, events: UsageEvent[]): FlowBlock {
  return {
    blockIndex,
    label: 'Deep Flow',
    start,
    end,
    durationMs: Date.parse(end) - Date.parse(start),
    eventCount: events.length,
    inputTokens: events.reduce((s, e) => s + e.inputTokens, 0),
    outputTokens: events.reduce((s, e) => s + e.outputTokens, 0),
    cacheReadTokens: events.reduce((s, e) => s + e.cacheReadTokens, 0),
    cacheWriteTokens: events.reduce((s, e) => s + e.cacheWriteTokens, 0),
    totalTokens: events.reduce((s, e) => s + e.totalTokens, 0),
    cost: events.reduce((s, e) => s + e.cost, 0),
    dominantModel: events[0]?.model ?? 'unknown',
    events,
    modelSwitches: 0,
    cacheHitRateTrend: [0.4, 0.6],
  };
}

function makeReport(): ReplayReport {
  const events: UsageEvent[] = [
    ev('2026-04-22T09:30:00.000', 'claude-sonnet-4', 1_000, 0.01),
    ev('2026-04-22T09:32:00.000', 'claude-sonnet-4', 2_000, 0.02),
    ev('2026-04-22T11:00:00.000', 'gpt-5.4', 3_000, 0.03),
  ];
  return {
    date: '2026-04-22',
    events,
    flowBlocks: [
      block(0, '2026-04-22T09:30:00.000', '2026-04-22T09:32:00.000', events.slice(0, 2)),
      block(1, '2026-04-22T11:00:00.000', '2026-04-22T11:00:00.000', events.slice(2, 3)),
    ],
    tokenVelocity: [
      { minute: '2026-04-22T09:30:00.000', tokensPerMinute: 1_000 },
      { minute: '2026-04-22T11:00:00.000', tokensPerMinute: 3_000 },
    ],
    summary: {
      totalSessions: 2,
      totalEvents: 3,
      flowTimeMs: 120_000,
      thinkTimeMs: 5_280_000,
      flowThinkRatio: 0.022,
      peakMinute: { minute: '2026-04-22T11:00:00.000', tokensPerMinute: 3_000 },
    },
  };
}

function makePlayback(): ReplayPlaybackView {
  const r = makeReport();
  const summary = computePlaybackSummary(r, 1)!;
  const totalDayCost = r.events.reduce((s, e) => s + e.cost, 0);
  return { cursorIndex: 1, active: true, speed: 240, summary, totalDayCost };
}

describe('createReplayPanel', () => {
  test('overview mode renders pulse chart and day summary', () => {
    const panel = createReplayPanel(makeReport(), '2026-04-22', 0, null, 0);
    const text = collectTextContent(panel).join('\n');
    expect(text).toContain('Pulse (tok/min)');
    expect(text).toContain('Sessions: 2');
    expect(text).toContain('Flow Blocks (2)');
    expect(text).toContain('[s] enter step/playback');
    expect(text).not.toContain('[n/p] step');
  });

  test('playback mode SLIMS the panel: no pulse chart, no day summary, fewer blocks', () => {
    const panel = createReplayPanel(
      makeReport(),
      '2026-04-22',
      1,
      null,
      0,
      undefined,
      undefined,
      makePlayback(),
    );
    const text = collectTextContent(panel).join('\n');
    // The two heavy sections must not appear in playback — they're the
    // ones that pushed the panel past the terminal viewport and caused
    // opentui's flex layout to compress sibling rows on top of each other.
    expect(text).not.toContain('Pulse (tok/min)');
    expect(text).not.toContain('Sessions: 2  |  Events:');
    // The events-near-cursor list IS shown.
    expect(text).toContain('Events near cursor');
    // Help is a SINGLE row, not two.
    expect(text.split('\n').filter((l) => l.includes('[space]')).length).toBe(1);
  });

  test('replay panel no longer carries the per-view "press [o]" banner', () => {
    // The "open browser" affordance lives in the global footer status bar
    // now, so the panel itself should not duplicate it.
    const overview = collectTextContent(createReplayPanel(makeReport(), '2026-04-22', 0, null, 0)).join('\n');
    expect(overview).not.toContain('press [o]');
    expect(overview).not.toContain('browser scrub');

    const playback = collectTextContent(
      createReplayPanel(makeReport(), '2026-04-22', 1, null, 0, undefined, undefined, makePlayback()),
    ).join('\n');
    expect(playback).not.toContain('press [o]');
  });

  test('null-report path renders the date header without a banner', () => {
    const panel = createReplayPanel(null, '2026-04-22', 0, null, 0);
    const text = collectTextContent(panel).join('\n');
    expect(text).toContain('Replay:');
    expect(text).not.toContain('press [o]');
  });
});
