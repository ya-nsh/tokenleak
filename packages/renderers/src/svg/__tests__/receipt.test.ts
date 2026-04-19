import { describe, expect, it } from 'bun:test';
import type { Receipt } from '@tokenleak/core';
import { renderReceiptSvg } from '../receipt';

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

describe('renderReceiptSvg', () => {
  it('returns a valid SVG document', () => {
    const svg = renderReceiptSvg(makeReceipt());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('includes the TOKENLEAK header and date range', () => {
    const svg = renderReceiptSvg(makeReceipt());
    expect(svg).toContain('TOKENLEAK');
    expect(svg).toContain('ITEMIZED RECEIPT');
    expect(svg).toContain('2026-04-01');
    expect(svg).toContain('2026-04-30');
  });

  it('renders every line item with quantity, description, and cost', () => {
    const svg = renderReceiptSvg(makeReceipt());
    expect(svg).toContain('fix the lint error');
    expect(svg).toContain('center a div horizontally');
    expect(svg).toContain('7×');
    expect(svg).toContain('3×');
    expect(svg).toContain('$0.83');
    expect(svg).toContain('$0.42');
  });

  it('maps categories to display labels', () => {
    const svg = renderReceiptSvg(makeReceipt());
    expect(svg).toContain('DEBUGGING');
    expect(svg).toContain('STYLING');
  });

  it('shows subtotal, service fees, and total', () => {
    const svg = renderReceiptSvg(makeReceipt());
    expect(svg).toContain('SUBTOTAL');
    expect(svg).toContain('SERVICE FEES');
    expect(svg).toContain('TOTAL');
    expect(svg).toContain('$1.25');
    expect(svg).toContain('$1.65');
  });

  it('renders a placeholder when there are no line items', () => {
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
    const svg = renderReceiptSvg(empty);
    expect(svg).toContain('No itemized prompts captured');
  });

  it('supports light theme', () => {
    const dark = renderReceiptSvg(makeReceipt(), { theme: 'dark' });
    const light = renderReceiptSvg(makeReceipt(), { theme: 'light' });
    expect(dark).not.toBe(light);
    expect(light).toContain('#f7f2e4');
  });

  it('escapes XML special characters in descriptions', () => {
    const receipt = makeReceipt({
      lines: [
        {
          description: 'fix <script>alert("xss")</script> here',
          category: 'debugging',
          quantity: 1,
          totalCost: 0.01,
          totalTokens: 100,
        },
      ],
    });
    const svg = renderReceiptSvg(receipt);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('produces a footer with tokenleak attribution', () => {
    const svg = renderReceiptSvg(makeReceipt());
    expect(svg).toContain('THANK YOU FOR YOUR PATRONAGE');
    expect(svg).toContain('tokenleak');
  });

  it('formats every amount as $X.XX (no three-decimal or cent-less values)', () => {
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
    const svg = renderReceiptSvg(receipt);
    const amounts = svg.match(/\$\d+\.\d{2}(?!\d)/g) ?? [];
    expect(amounts.length).toBeGreaterThan(0);
    expect(svg).not.toMatch(/\$\d+\.\d{3}/);
  });

  it('reserves space for an empty-state block so the footer does not overlap the tear edge', () => {
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
    const populated = makeReceipt();
    const emptyHeight = Number(empty && /height="(\d+)"/.exec(renderReceiptSvg(empty))?.[1]);
    const populatedHeight = Number(/height="(\d+)"/.exec(renderReceiptSvg(populated))?.[1]);
    expect(emptyHeight).toBeGreaterThan(0);
    // Empty receipts should still have meaningful height (at least ~500 px for header + totals + footer).
    expect(emptyHeight).toBeGreaterThanOrEqual(500);
    // Populated receipts should be taller than empty because line items consume space.
    expect(populatedHeight).toBeGreaterThan(emptyHeight);
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
    const svg = renderReceiptSvg(receipt);
    expect(svg).toContain('Other prompt clusters (42)');
    expect(svg).toContain('$3.50');
  });
});
