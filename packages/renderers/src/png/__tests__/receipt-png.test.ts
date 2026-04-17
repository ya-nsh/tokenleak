import { describe, expect, it } from 'bun:test';
import type { Receipt } from '@tokenleak/core';
import { renderReceiptPng } from '../receipt-png';

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47];

const SAMPLE_RECEIPT: Receipt = {
  lines: [
    {
      description: 'fix the lint error',
      category: 'debugging',
      quantity: 7,
      totalCost: 0.83,
      totalTokens: 12_000,
    },
  ],
  summary: {
    dateRange: { since: '2026-04-01', until: '2026-04-30' },
    accountedPrompts: 7,
    unlabeledEvents: 2,
    subtotal: 0.83,
    serviceFees: 0.15,
    total: 0.98,
  },
};

describe('renderReceiptPng', () => {
  it.skip('output starts with PNG magic bytes (run manually with --timeout 30000)', async () => {
    const buf = await renderReceiptPng(SAMPLE_RECEIPT, { theme: 'dark' });
    expect(buf).toBeInstanceOf(Buffer);
    for (let i = 0; i < PNG_MAGIC_BYTES.length; i++) {
      expect(buf[i]).toBe(PNG_MAGIC_BYTES[i]!);
    }
  });
});
