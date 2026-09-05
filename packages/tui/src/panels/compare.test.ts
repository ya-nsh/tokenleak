import { expect, test } from 'bun:test';
import { aggregate, buildCompareOutput } from '@tokenleak/core';
import { createInitialState } from '../lib/state';
import { createComparePanel } from './compare';

function text(node: any): string { return (node?.props?.content ?? '') + (node?.children ?? []).map(text).join(''); }
const range = { since: '2026-03-12', until: '2026-03-12' };
function stats(tokens: number) {
  return aggregate([{ date: range.since, inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0,
    cacheWriteTokens: 0, totalTokens: tokens, cost: tokens / 100, models: [] }], range.until, range);
}
function compare(previous: number, current: number) {
  return text(createComparePanel(createInitialState(), buildCompareOutput(
    { range, stats: stats(previous) }, { range, stats: stats(current) },
  )));
}

test('shows relative percentage changes for tokens, cost, and average', () => {
  const rendered = compare(1000, 2000);
  expect(rendered.match(/\+100\.0%/g)).toHaveLength(3);
  expect(rendered).not.toContain('+100000.0%');
  expect(compare(2000, 1000).match(/-50\.0%/g)).toHaveLength(3);
});
test('handles zero baselines without Infinity or NaN', () => {
  expect(compare(0, 1000).match(/New/g)).toHaveLength(3);
  expect(compare(0, 0).match(/\+0\.0%/g)).toHaveLength(3);
  expect(compare(1000, 0).match(/-100\.0%/g)).toHaveLength(3);
});
