import { describe, expect, test } from 'bun:test';
import type { UsageEvent } from '@tokenleak/core';
import { buildPricingReport, renderPricingReport, type PricingReportDeps } from './pricing-report';

const RANGE = { since: '2026-10-01', until: '2026-10-31' };
const OPUS = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

function event(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    provider: 'claude-code',
    timestamp: '2026-10-01T00:00:00.000Z',
    date: '2026-10-01',
    model: 'claude-opus-5-5',
    inputTokens: 10,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 20,
    cost: 0.5,
    costSource: 'estimated',
    ...overrides,
  };
}

const deps: PricingReportDeps = {
  resolve: (model) => (model === 'claude-opus-5-5' ? { pricing: OPUS, source: 'verified' } : undefined),
  overridePath: '/nonexistent/tokenleak/pricing.json',
  remote: { state: 'fresh', fetchedAt: Date.parse('2026-10-31T10:00:00Z') },
};

describe('buildPricingReport', () => {
  test('groups usage by model and sorts by tokens', () => {
    const report = buildPricingReport(
      [
        event({}),
        event({ provider: 'codex', totalTokens: 200, model: 'mystery-1', unpricedTokens: 200, cost: 0, costSource: 'unpriced' }),
        event({}),
      ],
      RANGE,
      deps,
    );
    expect(report.rows.map((row) => row.model)).toEqual(['mystery-1', 'claude-opus-5-5']);
    expect(report.rows[1]).toMatchObject({ totalTokens: 40, cost: 1, source: 'verified', providers: ['claude-code'] });
    expect(report.rows[0]).toMatchObject({ source: 'unpriced', pricing: null });
    expect(report.unpricedTokens).toBe(200);
    expect(report.overrideFileExists).toBe(false);
  });

  test('labels models whose cost came from the provider itself', () => {
    const report = buildPricingReport(
      [event({ model: 'cursor-auto', costSource: 'provider-reported', cost: 2 })],
      RANGE,
      deps,
    );
    expect(report.rows[0]!.source).toBe('provider-reported');
  });

  test('empty usage yields an empty report', () => {
    const report = buildPricingReport([], RANGE, deps);
    expect(report.rows).toEqual([]);
    expect(report.totalTokens).toBe(0);
  });
});

describe('renderPricingReport', () => {
  const now = Date.parse('2026-10-31T13:00:00Z');

  test('shows rates, sources, and the cache age', () => {
    const text = renderPricingReport(buildPricingReport([event({})], RANGE, deps), { noColor: true, now });
    expect(text).toContain('claude-opus-5-5');
    expect(text).toContain('verified');
    expect(text).toContain('$4.00');
    expect(text).toContain('$0.200');
    expect(text).toContain('Every token in this range has a known price.');
    expect(text).toContain('LiteLLM rates cached 3h ago');
    expect(text).toContain('(not present)');
  });

  test('tells the user how to price unknown models', () => {
    const report = buildPricingReport(
      [event({ model: 'mystery-1', unpricedTokens: 20, cost: 0, costSource: 'unpriced' })],
      RANGE,
      deps,
    );
    const text = renderPricingReport(report, { noColor: true, now });
    expect(text).toContain('UNKNOWN');
    expect(text).toContain('20 tokens have no known price (mystery-1).');
    expect(text).toContain('"mystery-1": {"input"');
  });

  test('handles a range without usage', () => {
    const text = renderPricingReport(buildPricingReport([], RANGE, deps), { noColor: true, now });
    expect(text).toContain('No usage in this range.');
  });

  test('no ANSI escapes with noColor', () => {
    const text = renderPricingReport(buildPricingReport([event({})], RANGE, deps), { noColor: true, now });
    expect(text).not.toContain('\u001b[');
  });

  test('describes an offline run', () => {
    const report = buildPricingReport([], RANGE, { ...deps, remote: { state: 'unavailable' } });
    expect(renderPricingReport(report, { noColor: true, now })).toContain('built-in rates only');
  });
});
