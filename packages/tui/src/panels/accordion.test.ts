import { describe, expect, test } from 'bun:test';
import type { FlowBlock, Receipt, ReplayReport, UsageEvent } from '@tokenleak/core';
import { createReplayPanel } from './replay.js';
import { createReceiptsPanel } from './receipts.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectTextContent(node: unknown): string[] {
  if (!isRecord(node)) {
    return [];
  }

  const props = node['props'];
  const ownContent =
    isRecord(props) && typeof props['content'] === 'string' ? [props['content']] : [];
  const children = Array.isArray(node['children'])
    ? node['children'].flatMap((child) => collectTextContent(child))
    : [];

  return [...ownContent, ...children];
}

function makeEvent(index: number, model: string): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: `2026-03-10T09:0${index}:00.000Z`,
    date: '2026-03-10',
    model,
    inputTokens: 1000 + index,
    outputTokens: 500 + index,
    cacheReadTokens: 250 + index,
    cacheWriteTokens: 50,
    totalTokens: 1800 + index,
    cost: 0.12 + index / 100,
    sessionId: 'session-1',
  };
}

function makeBlock(blockIndex: number, eventCount: number, model: string): FlowBlock {
  const events = Array.from({ length: eventCount }, (_, index) => makeEvent(index, model));
  return {
    blockIndex,
    label: blockIndex === 0 ? 'Deep Flow' : 'Quick Lookup',
    start: events[0]!.timestamp,
    end: events[events.length - 1]!.timestamp,
    durationMs: 60_000 * eventCount,
    eventCount,
    inputTokens: 5000,
    outputTokens: 2500,
    cacheReadTokens: 1200,
    cacheWriteTokens: 250,
    totalTokens: 8950,
    cost: 1.42,
    dominantModel: model,
    events,
    modelSwitches: 1,
    cacheHitRateTrend: [0.1, 0.5],
  };
}

function makeReplayReport(): ReplayReport {
  const model = 'claude-super-long-model-name-that-needs-truncation';
  const flowBlocks = [makeBlock(0, 5, model), makeBlock(1, 1, 'short-model')];
  const events = flowBlocks.flatMap((block) => block.events);
  return {
    date: '2026-03-10',
    events,
    flowBlocks,
    tokenVelocity: [{ minute: '2026-03-10T09:00:00.000Z', tokensPerMinute: 5000 }],
    summary: {
      totalSessions: 1,
      totalEvents: events.length,
      flowTimeMs: 300_000,
      thinkTimeMs: 60_000,
      flowThinkRatio: 0.83,
      peakMinute: { minute: '2026-03-10T09:00:00.000Z', tokensPerMinute: 5000 },
    },
  };
}

function makeReceipt(): Receipt {
  return {
    lines: [
      {
        description: 'A very long debugging prompt cluster description that must not collide with the cost column',
        category: 'debugging',
        quantity: 4,
        totalCost: 3.25,
        totalTokens: 12_000,
        samplePrompts: [
          'Please investigate this failing test with a very long prompt that needs wrapping inside the receipt details instead of overflowing the table.',
          'Another representative debugging prompt with enough text to exercise the wrapped sample prompt rendering.',
        ],
      },
      {
        description: 'Short refactor request',
        category: 'refactoring',
        quantity: 1,
        totalCost: 0.5,
        totalTokens: 1000,
        samplePrompts: [],
      },
    ],
    summary: {
      dateRange: { since: '2026-03-10', until: '2026-03-10' },
      accountedPrompts: 5,
      unlabeledEvents: 0,
      subtotal: 3.75,
      serviceFees: 0,
      total: 3.75,
    },
  };
}

describe('Replay accordion panel', () => {
  test('renders a selected collapsed block without expanded details', () => {
    const lines = collectTextContent(createReplayPanel(makeReplayReport(), '2026-03-10', 0, null, 0));

    expect(lines.some((line) => line.includes('▸ ▶ 09:00'))).toBe(true);
    expect(lines.some((line) => line.includes('Model:'))).toBe(false);
  });

  test('renders expanded details in bounded text lines', () => {
    const lines = collectTextContent(createReplayPanel(makeReplayReport(), '2026-03-10', 0, 0, 0));

    expect(lines.some((line) => line.includes('▸ ▼ 09:00'))).toBe(true);
    expect(lines.some((line) => line.includes('Model: claude-super-long-model-name'))).toBe(true);
    expect(lines.some((line) => line.includes('+1 more events'))).toBe(true);
    expect(lines.every((line) => line.length <= 78)).toBe(true);
  });

  test('honors a narrower caller-provided content width', () => {
    const lines = collectTextContent(createReplayPanel(makeReplayReport(), '2026-03-10', 0, 0, 0, 50));

    expect(lines.some((line) => line.includes('▸ ▼'))).toBe(true);
    expect(lines.every((line) => line.length <= 50)).toBe(true);
  });
});

describe('Receipts accordion panel', () => {
  test('keeps selection independent from expansion', () => {
    const state = {
      receiptsScrollOffset: 0,
      receiptsSelectedLineIndex: 1,
      receiptsExpandedLineIndex: 0,
      receiptsSortMode: 'cost' as const,
      receiptsCategoryFilter: null,
    };
    const lines = collectTextContent(createReceiptsPanel(state, makeReceipt()));

    expect(lines.some((line) => line.includes('▼') && line.includes('1.'))).toBe(true);
    expect(lines.some((line) => line.includes('▸ ▶') && line.includes('2.'))).toBe(true);
  });

  test('wraps expanded sample prompts into bounded detail lines', () => {
    const state = {
      receiptsScrollOffset: 0,
      receiptsSelectedLineIndex: 0,
      receiptsExpandedLineIndex: 0,
      receiptsSortMode: 'cost' as const,
      receiptsCategoryFilter: null,
    };
    const lines = collectTextContent(createReceiptsPanel(state, makeReceipt()));

    expect(lines.some((line) => line.includes('▸ ▼') && line.includes('1.'))).toBe(true);
    expect(lines.some((line) => line.includes('└ Please investigate this failing test'))).toBe(true);
    expect(lines.every((line) => line.length <= 78)).toBe(true);
  });

  test('honors a narrower caller-provided content width', () => {
    const state = {
      receiptsScrollOffset: 0,
      receiptsSelectedLineIndex: 0,
      receiptsExpandedLineIndex: 0,
      receiptsSortMode: 'cost' as const,
      receiptsCategoryFilter: null,
    };
    const lines = collectTextContent(createReceiptsPanel(state, makeReceipt(), 50));

    expect(lines.some((line) => line.includes('▸ ▼'))).toBe(true);
    expect(lines.every((line) => line.length <= 50)).toBe(true);
  });
});
