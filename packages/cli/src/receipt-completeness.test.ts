import { expect, test } from 'bun:test';
import { buildReceipt, type UsageEvent } from '@tokenleak/core';
import { renderReceiptSvg } from '@tokenleak/renderers';
import { renderReceiptTerminal } from './receipts';

test('receipt exports distinguish unknown prices, partial totals, and reported zero', () => {
  const range = { since: '2026-03-12', until: '2026-03-12' };
  const event: UsageEvent = { provider: 'codex', date: range.since, timestamp: `${range.since}T10:00:00Z`,
    model: 'unknown-model', inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    totalTokens: 100, cost: 0, costSource: 'unpriced', prompt: 'Implement this feature' };
  const unknown = buildReceipt([event], range);
  expect(renderReceiptTerminal(unknown)).toMatch(/TOTAL\s+Unknown/);
  expect(renderReceiptSvg(unknown)).toContain('Unknown');
  const partial = buildReceipt([event, { ...event, model: 'known', cost: 1, costSource: 'provider-reported' }], range);
  expect(renderReceiptTerminal(partial)).toMatch(/TOTAL\s+\$1\.00\+/);
  expect(renderReceiptSvg(partial)).toContain('$1.00+');
  const free = buildReceipt([{ ...event, costSource: 'provider-reported' }], range);
  expect(renderReceiptTerminal(free)).toMatch(/TOTAL\s+\$0\.00/);
});


test.each([undefined, 'Implement this feature'])('preserves known cost-only spend in receipts (prompt=%s)', (prompt) => {
  const range = { since: '2026-03-12', until: '2026-03-12' };
  const event: UsageEvent = { provider: 'codex', date: range.since, timestamp: `${range.since}T10:00:00Z`,
    model: 'unknown-model', inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    totalTokens: 100, cost: 0, costSource: 'unpriced', prompt };
  const receipt = buildReceipt([event, { ...event, provider: 'crush', model: 'session-total', inputTokens: 0,
    totalTokens: 0, cost: 25, costSource: 'provider-reported' }], range);
  expect(receipt.summary.total).toBe(25);
  expect(receipt.summary.costCompleteness?.status).toBe('partial');
  expect(renderReceiptTerminal(receipt)).toMatch(/TOTAL\s+\$25\.00\+/);
  expect(renderReceiptSvg(receipt)).toContain('$25.00+');
});
