import { describe, expect, it } from 'bun:test';
import type { Receipt } from '@tokenleak/core';
import { renderReceiptTerminal } from './receipts';

function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    lines: [
      {
        description: 'fix the lint error',
        category: 'debugging',
        quantity: 7,
        totalCost: 0.83,
        totalTokens: 12_000,
      },
      {
        description: 'center a div horizontally',
        category: 'styling',
        quantity: 3,
        totalCost: 0.42,
        totalTokens: 6_200,
      },
    ],
    summary: {
      dateRange: { since: '2026-04-01', until: '2026-04-30' },
      accountedPrompts: 10,
      unlabeledEvents: 5,
      subtotal: 1.25,
      serviceFees: 0.4,
      total: 1.65,
    },
    ...overrides,
  };
}

const AMOUNT_PATTERN = /\$\d+\.\d{2}(?!\d)/g;

describe('renderReceiptTerminal', () => {
  it('renders the header, date range, and totals block', () => {
    const out = renderReceiptTerminal(makeReceipt(), 80);
    expect(out).toContain('TOKENLEAK');
    expect(out).toContain('ITEMIZED RECEIPT');
    expect(out).toContain('2026-04-01 — 2026-04-30');
    expect(out).toContain('SUBTOTAL');
    expect(out).toContain('SERVICE FEES');
    expect(out).toContain('TOTAL');
  });

  it('renders every cost with exactly two decimal places', () => {
    const receipt = makeReceipt({
      lines: [
        { description: 'tiny', category: 'misc', quantity: 1, totalCost: 0.001, totalTokens: 10 },
        { description: 'big', category: 'misc', quantity: 1, totalCost: 123.4, totalTokens: 10 },
      ],
      summary: {
        dateRange: { since: '2026-04-01', until: '2026-04-30' },
        accountedPrompts: 2,
        unlabeledEvents: 0,
        subtotal: 123.401,
        serviceFees: 0,
        total: 123.401,
      },
    });
    const out = renderReceiptTerminal(receipt, 80);
    const amounts = out.match(AMOUNT_PATTERN) ?? [];
    expect(amounts.length).toBeGreaterThan(0);
    for (const amount of amounts) {
      expect(amount).toMatch(/^\$\d+\.\d{2}$/);
    }
    // No three-decimal amounts leaked.
    expect(out).not.toMatch(/\$\d+\.\d{3}/);
  });

  it('truncates long descriptions with an ellipsis within the row width', () => {
    const longDescription = 'refactor the massive module '.repeat(20).trim();
    const receipt = makeReceipt({
      lines: [
        {
          description: longDescription,
          category: 'refactoring',
          quantity: 1,
          totalCost: 0.01,
          totalTokens: 100,
        },
      ],
    });
    const width = 60;
    const out = renderReceiptTerminal(receipt, width);
    const rows = out.split('\n');
    // Row-item lines contain cost at the end; each row must fit the width.
    for (const row of rows) {
      expect(row.length).toBeLessThanOrEqual(width);
    }
    expect(out).toContain('…');
  });

  it('renders the empty-state message with no line items', () => {
    const empty = makeReceipt({
      lines: [],
      summary: {
        dateRange: { since: '2026-04-01', until: '2026-04-30' },
        accountedPrompts: 0,
        unlabeledEvents: 0,
        subtotal: 0,
        serviceFees: 0,
        total: 0,
      },
    });
    const out = renderReceiptTerminal(empty, 80);
    expect(out).toContain('No itemized prompts captured in this period.');
    expect(out).toContain('$0.00');
    // Totals always present even for empty receipts.
    expect(out).toContain('TOTAL');
  });

  it('renders the overflow "Other prompt clusters" line when present', () => {
    const receipt = makeReceipt({
      lines: [
        ...makeReceipt().lines,
        {
          description: 'Other prompt clusters (42)',
          category: 'misc',
          quantity: 99,
          totalCost: 3.5,
          totalTokens: 100_000,
        },
      ],
    });
    const out = renderReceiptTerminal(receipt, 80);
    expect(out).toContain('Other prompt clusters (42)');
  });

  it('maps categories to short-form labels', () => {
    const out = renderReceiptTerminal(makeReceipt(), 80);
    expect(out).toContain('DEBUGGING');
    expect(out).toContain('STYLING');
  });

  it('clamps width below the 40-column floor', () => {
    const out = renderReceiptTerminal(makeReceipt(), 10);
    // Clamped to 40 — header label fits.
    const rows = out.split('\n');
    for (const row of rows) {
      expect(row.length).toBeLessThanOrEqual(40);
    }
  });
});
