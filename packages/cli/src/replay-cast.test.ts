import { describe, expect, it } from 'bun:test';
import type { ReplayReport, UsageEvent } from '@tokenleak/core';
import { CAST_DEFAULT_SPEED, buildReplayCast, computeReplayCastFrames } from './replay-cast';

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

function makeReport(events: UsageEvent[] = []): ReplayReport {
  const list = events.length > 0
    ? events
    : [
        ev('2026-04-22T09:30:00.000', 'claude-sonnet-4', 1_000, 0.01),
        ev('2026-04-22T09:32:00.000', 'gpt-5.4', 2_000, 0.02),
        ev('2026-04-22T14:00:00.000', 'claude-opus-4-7', 50_000, 2.5),
      ];
  return {
    date: '2026-04-22',
    events: list,
    flowBlocks: [
      {
        blockIndex: 0,
        label: 'Deep Flow',
        start: list[0].timestamp,
        end: list[list.length - 1].timestamp,
        durationMs: Date.parse(list[list.length - 1].timestamp) - Date.parse(list[0].timestamp),
        eventCount: list.length,
        inputTokens: list.reduce((s, e) => s + e.inputTokens, 0),
        outputTokens: list.reduce((s, e) => s + e.outputTokens, 0),
        cacheReadTokens: list.reduce((s, e) => s + e.cacheReadTokens, 0),
        cacheWriteTokens: list.reduce((s, e) => s + e.cacheWriteTokens, 0),
        totalTokens: list.reduce((s, e) => s + e.totalTokens, 0),
        cost: list.reduce((s, e) => s + e.cost, 0),
        dominantModel: list[0].model,
        events: list,
        modelSwitches: 0,
        cacheHitRateTrend: [0.5, 0.7],
      },
    ],
    tokenVelocity: list.map((e) => ({ minute: e.timestamp, tokensPerMinute: e.totalTokens })),
    summary: {
      totalSessions: 1,
      totalEvents: list.length,
      flowTimeMs: Date.parse(list[list.length - 1].timestamp) - Date.parse(list[0].timestamp),
      thinkTimeMs: 0,
      flowThinkRatio: 1,
      peakMinute: { minute: list[0].timestamp, tokensPerMinute: list[0].totalTokens },
    },
  };
}

describe('buildReplayCast', () => {
  it('emits a v2 header on line 1', () => {
    const cast = buildReplayCast(makeReport(), { nowSeconds: 1_700_000_000 });
    const firstLine = cast.split('\n')[0];
    const header = JSON.parse(firstLine);
    expect(header.version).toBe(2);
    expect(header.timestamp).toBe(1_700_000_000);
    expect(header.title).toContain('2026-04-22');
    expect(typeof header.width).toBe('number');
    expect(typeof header.height).toBe('number');
  });

  it('emits one frame per event', () => {
    const cast = buildReplayCast(makeReport());
    const frameLines = cast.trim().split('\n').slice(1);
    expect(frameLines.length).toBe(3);
  });

  it('frames are valid JSON arrays of [t, "o", data]', () => {
    const cast = buildReplayCast(makeReport());
    const frameLines = cast.trim().split('\n').slice(1);
    for (const line of frameLines) {
      const parsed = JSON.parse(line);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(3);
      expect(typeof parsed[0]).toBe('number');
      expect(parsed[1]).toBe('o');
      expect(typeof parsed[2]).toBe('string');
    }
  });

  it('frame timing scales with --speed (faster speed = earlier frame timestamps)', () => {
    const slow = computeReplayCastFrames(makeReport(), { speed: 60, width: 100 });
    const fast = computeReplayCastFrames(makeReport(), { speed: 600, width: 100 });
    // Last frame at 600× should be 10× earlier than at 60×
    expect(fast[fast.length - 1].t).toBeCloseTo(slow[slow.length - 1].t / 10, 5);
  });

  it('default speed is the documented constant', () => {
    expect(CAST_DEFAULT_SPEED).toBe(240);
  });

  it('frames begin with a screen clear escape so each frame replaces the prior', () => {
    const frames = computeReplayCastFrames(makeReport(), { speed: 240, width: 100 });
    for (const frame of frames) {
      expect(frame.data.startsWith('\x1b[2J\x1b[H')).toBe(true);
    }
  });

  it('frames render the cumulative cost, the cursor event, and a model-mix bar', () => {
    const frames = computeReplayCastFrames(makeReport(), { speed: 240, width: 100 });
    const finalFrame = frames[frames.length - 1].data;
    expect(finalFrame).toContain('cost:');
    expect(finalFrame).toContain('event:');
    expect(finalFrame).toContain('claude-opus-4-7');
    expect(finalFrame).toContain('model mix');
    // Total cost should appear in the final frame's stats line.
    expect(finalFrame).toContain('$2.53');
  });

  it('handles empty days with a single placeholder frame', () => {
    const empty = makeReport([]);
    empty.events = [];
    empty.flowBlocks = [];
    empty.tokenVelocity = [];
    empty.summary.totalEvents = 0;
    const cast = buildReplayCast(empty);
    const frameLines = cast.trim().split('\n').slice(1);
    expect(frameLines.length).toBe(1);
    expect(frameLines[0]).toContain('no events');
  });
});
