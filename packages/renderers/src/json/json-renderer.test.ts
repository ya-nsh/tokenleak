import { describe, expect, it } from 'bun:test';
import type {
  ProviderData,
} from '@tokenleak/core';
import { SCHEMA_VERSION } from '@tokenleak/core';
import { JsonRenderer } from './json-renderer';
import {
  createOutput,
  createMoreStats,
  createRenderOptions,
  createZeroedStats,
} from '../__test-fixtures__';

function createMinimalTokenleakOutput(
  overrides: Parameters<typeof createOutput>[0] = {},
) {
  return createOutput({
    providers: [],
    aggregated: createZeroedStats(),
    ...overrides,
  });
}

function createDefaultRenderOptions() {
  return createRenderOptions({
    format: 'json',
    width: 1200,
    showInsights: false,
  });
}

describe('JsonRenderer', () => {
  const renderer = new JsonRenderer();
  const options = createDefaultRenderOptions();

  it('has format set to json', () => {
    expect(renderer.format).toBe('json');
  });

  it('produces valid JSON that can be parsed back', async () => {
    const output = createMinimalTokenleakOutput();
    const result = await renderer.render(output, options);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual(output);
  });

  it('includes schemaVersion in the output', async () => {
    const output = createMinimalTokenleakOutput();
    const result = await renderer.render(output, options);
    const parsed = JSON.parse(result);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('includes provider names in the output', async () => {
    const provider: ProviderData = {
      provider: 'anthropic',
      displayName: 'Anthropic',
      daily: [],
      totalTokens: 1000,
      totalCost: 0.05,
      colors: {
        primary: '#d97706',
        secondary: '#fbbf24',
        gradient: ['#d97706', '#fbbf24'],
      },
    };
    const output = createMinimalTokenleakOutput({
      providers: [provider],
    });
    const result = await renderer.render(output, options);
    const parsed = JSON.parse(result);
    expect(parsed.providers).toHaveLength(1);
    expect(parsed.providers[0].provider).toBe('anthropic');
    expect(parsed.providers[0].displayName).toBe('Anthropic');
  });

  it('handles empty providers array', async () => {
    const output = createMinimalTokenleakOutput({ providers: [] });
    const result = await renderer.render(output, options);
    const parsed = JSON.parse(result);
    expect(parsed.providers).toEqual([]);
  });

  it('includes the generated timestamp', async () => {
    const timestamp = '2026-03-11T12:30:00.000Z';
    const output = createMinimalTokenleakOutput({ generated: timestamp });
    const result = await renderer.render(output, options);
    const parsed = JSON.parse(result);
    expect(parsed.generated).toBe(timestamp);
  });

  it('preserves the dateRange', async () => {
    const dateRange = { since: '2026-02-01', until: '2026-02-28' };
    const output = createMinimalTokenleakOutput({ dateRange });
    const result = await renderer.render(output, options);
    const parsed = JSON.parse(result);
    expect(parsed.dateRange).toEqual(dateRange);
  });

  it('preserves aggregated stats', async () => {
    const aggregated = createZeroedStats();
    aggregated.currentStreak = 5;
    aggregated.longestStreak = 12;
    aggregated.totalTokens = 50000;
    aggregated.totalCost = 2.5;
    aggregated.activeDays = 10;
    aggregated.totalDays = 30;
    aggregated.cacheHitRate = 0.42;
    aggregated.peakDay = { date: '2026-03-01', tokens: 8000 };
    const output = createMinimalTokenleakOutput({ aggregated });
    const result = await renderer.render(output, options);
    const parsed = JSON.parse(result);
    expect(parsed.aggregated.currentStreak).toBe(5);
    expect(parsed.aggregated.longestStreak).toBe(12);
    expect(parsed.aggregated.totalTokens).toBe(50000);
    expect(parsed.aggregated.totalCost).toBe(2.5);
    expect(parsed.aggregated.cacheHitRate).toBe(0.42);
    expect(parsed.aggregated.peakDay).toEqual({ date: '2026-03-01', tokens: 8000 });
  });

  it('preserves attribution clusters inside more stats', async () => {
    const output = createMinimalTokenleakOutput({
      more: createMoreStats({
        attribution: [
          {
            clusterId: 'repo:/Users/test/work::dir:tokenleak::style:quick-hit',
            label: 'tokenleak · quick hit',
            taskStyle: 'quick-hit',
            repoRoot: '/Users/test/work',
            directory: 'tokenleak',
            sessionCount: 2,
            activeDays: 1,
            tokens: 48000,
            cost: 1.2,
            providers: ['claude-code', 'pi'],
            models: ['claude-3-opus'],
            timeWindows: [
              {
                start: '2026-03-01T09:00:00.000Z',
                end: '2026-03-01T10:00:00.000Z',
                sessionCount: 2,
              },
            ],
          },
        ],
      }),
    });

    const result = await renderer.render(output, options);
    const parsed = JSON.parse(result);

    expect(parsed.more.attribution).toHaveLength(1);
    expect(parsed.more.attribution[0].taskStyle).toBe('quick-hit');
    expect(parsed.more.attribution[0].timeWindows[0].sessionCount).toBe(2);
  });
});
