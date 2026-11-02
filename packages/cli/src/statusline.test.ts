import { describe, expect, test } from 'bun:test';
import type { DailyUsage } from '@tokenleak/core';
import { buildStatusline, renderStatusline } from './statusline';

function day(date: string, totalTokens: number, cost: number, priced = true): DailyUsage {
  return {
    date,
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
    cost,
    models: [
      {
        model: priced ? 'claude-opus-5-5' : 'mystery',
        inputTokens: totalTokens,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens,
        cost,
        costSource: priced ? 'estimated' : 'unpriced',
        unpricedTokens: priced ? 0 : totalTokens,
      },
    ],
  };
}

describe('buildStatusline', () => {
  const daily = [
    day('2026-10-20', 999, 99),
    day('2026-10-28', 10, 1),
    day('2026-11-01', 100, 10),
    day('2026-11-02', 200, 20),
    day('2026-11-03', 300, 30),
  ];

  test('sums today and the trailing seven days including today', () => {
    const summary = buildStatusline(daily, '2026-11-03');
    expect(summary.today.cost).toBe(30);
    expect(summary.week.cost).toBe(61);
    expect(summary.week.tokens).toBe(610);
  });

  test('the week starts six days before today, inclusive', () => {
    expect(buildStatusline(daily, '2026-11-03').week.cost).toBe(61);
    expect(buildStatusline([day('2026-10-27', 1, 5)], '2026-11-03').week.cost).toBe(0);
    expect(buildStatusline([day('2026-10-28', 1, 5)], '2026-11-03').week.cost).toBe(5);
  });

  test('counts the live streak, with the grace day', () => {
    expect(buildStatusline(daily, '2026-11-03').streak).toBe(3);
    expect(buildStatusline(daily, '2026-11-04').streak).toBe(3);
  });

  test('ignores zero days and handles no history', () => {
    const summary = buildStatusline([day('2026-11-03', 0, 0)], '2026-11-03');
    expect(summary.today.tokens).toBe(0);
    expect(summary.streak).toBe(0);
  });
});

describe('renderStatusline', () => {
  test('one plain line with cost, week, and streak', () => {
    const line = renderStatusline(buildStatusline([day('2026-11-02', 5_000, 4), day('2026-11-03', 120_000_000, 42.1)], '2026-11-03'), {
      noColor: true,
    });
    expect(line).toBe('$42.10 today (120M) · $46.10 7d · 2d streak');
    expect(line).not.toContain('\n');
  });

  test('says when there is no usage today and omits a zero streak', () => {
    expect(renderStatusline(buildStatusline([], '2026-11-03'), { noColor: true })).toBe('no usage today · $0.00 7d');
  });

  test('marks unpriced spend instead of showing $0.00', () => {
    const line = renderStatusline(buildStatusline([day('2026-11-03', 100, 0, false)], '2026-11-03'), { noColor: true });
    expect(line).toStartWith('Unknown today');
  });

  test('no ANSI with noColor; color otherwise', () => {
    const summary = buildStatusline([day('2026-11-03', 100, 1)], '2026-11-03');
    expect(renderStatusline(summary, { noColor: true })).not.toContain('\u001b[');
    expect(renderStatusline(summary, { noColor: false })).toContain('\u001b[');
  });
});
