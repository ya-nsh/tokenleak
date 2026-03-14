import { describe, expect, it } from 'bun:test';
import { aggregate, mergeProviderData } from '@tokenleak/core';
import type {
  CompareDeltas,
  DailyUsage,
  ProviderData,
} from '@tokenleak/core';
import { TerminalRenderer } from './terminal-renderer';
import {
  createOutput,
  createRenderOptions,
  createZeroedStats,
} from '../__test-fixtures__';

function createDailyUsageSequence(days: number, startDate = '2026-03-01', baseTokens = 1800): DailyUsage[] {
  const daily: DailyUsage[] = [];
  const baseDate = new Date(startDate);

  for (let index = 0; index < days; index += 1) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + index);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const totalTokens = baseTokens + index * 200;
    daily.push({
      date: dateStr,
      inputTokens: Math.floor(totalTokens * 0.55),
      outputTokens: Math.floor(totalTokens * 0.3),
      cacheReadTokens: Math.floor(totalTokens * 0.1),
      cacheWriteTokens: Math.floor(totalTokens * 0.05),
      totalTokens,
      cost: totalTokens * 0.00003,
      models: [
        {
          model: index % 2 === 0 ? 'claude-sonnet-4' : 'claude-opus-4',
          inputTokens: Math.floor(totalTokens * 0.55),
          outputTokens: Math.floor(totalTokens * 0.3),
          cacheReadTokens: Math.floor(totalTokens * 0.1),
          cacheWriteTokens: Math.floor(totalTokens * 0.05),
          totalTokens,
          cost: totalTokens * 0.00003,
        },
      ],
    });
  }

  return daily;
}

function createProvider(name: string, displayName: string, daily: DailyUsage[]): ProviderData {
  return {
    provider: name,
    displayName,
    daily,
    totalTokens: daily.reduce((sum, entry) => sum + entry.totalTokens, 0),
    totalCost: daily.reduce((sum, entry) => sum + entry.cost, 0),
    colors: {
      primary: '#d97706',
      secondary: '#fbbf24',
      gradient: ['#d97706', '#fbbf24'],
    },
  };
}

function createTerminalOutput(providers: ProviderData[]) {
  const dateRange = { since: '2026-03-01', until: '2026-03-14' } as const;
  return createOutput({
    dateRange,
    providers,
    aggregated: aggregate(mergeProviderData(providers), dateRange.until),
  });
}

function createTerminalOptions(overrides: Parameters<typeof createRenderOptions>[0] = {}) {
  return createRenderOptions({
    format: 'terminal',
    width: 96,
    showInsights: true,
    ...overrides,
  });
}

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '');
}

describe('TerminalRenderer', () => {
  const renderer = new TerminalRenderer();

  it('renders an oneliner for very narrow widths', async () => {
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(5)),
      createProvider('codex', 'Codex', []),
    ]);
    const result = await renderer.render(output, createTerminalOptions({ width: 28, noColor: true }));

    expect(result.split('\n')).toHaveLength(1);
    expect(result).toContain('streak');
    expect(result).toContain('1 active');
    expect(result).not.toContain('Heatmap');
  });

  it('renders a compact summary mode for medium widths', async () => {
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(5)),
      createProvider('codex', 'Codex', createDailyUsageSequence(4, '2026-03-02', 2200)),
    ]);
    const result = await renderer.render(output, createTerminalOptions({ width: 50, noColor: true }));

    expect(result).toContain('Range 2026-03-01 -> 2026-03-14');
    expect(result).toContain('Recent Trend');
    expect(result).toContain('Providers');
    expect(result).not.toContain('Heatmap');
  });

  it('renders overview-first full dashboards for wide widths', async () => {
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(6)),
      createProvider('codex', 'Codex', createDailyUsageSequence(5, '2026-03-03', 2400)),
    ]);
    const result = await renderer.render(output, createTerminalOptions({ width: 96, noColor: true }));

    expect(result).toContain('Overview');
    expect(result).toContain('Recent Trend');
    expect(result).toContain('Provider Mix');
    expect(result).toContain('Claude Code');
    expect(result).toContain('Codex');
  });

  it('collapses inactive providers into a note instead of full empty sections', async () => {
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(5)),
      createProvider('open-code', 'OpenCode', []),
    ]);
    const result = await renderer.render(output, createTerminalOptions({ width: 96, noColor: true }));

    expect(result).toContain('Claude Code');
    expect(result).toContain('No activity in range: OpenCode');
    expect(result).not.toContain('No usage data available');
  });

  it('hides empty rolling windows for sparse providers', async () => {
    const provider = createProvider('claude-code', 'Claude Code', createDailyUsageSequence(3, '2026-01-01'));
    const output = createOutput({
      dateRange: { since: '2026-01-01', until: '2026-03-14' },
      providers: [provider],
      aggregated: aggregate(mergeProviderData([provider]), '2026-03-14'),
    });
    const result = await renderer.render(output, createTerminalOptions({ width: 96, noColor: true }));

    expect(result).not.toContain('30d Tokens');
    expect(result).not.toContain('7d Tokens');
    expect(result).toContain('Total Tokens');
  });

  it('respects showInsights when disabled', async () => {
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(10)),
    ]);
    const result = await renderer.render(output, createTerminalOptions({ width: 96, noColor: true, showInsights: false }));

    expect(result).not.toContain('Insights');
  });

  it('produces no ANSI codes when noColor is true', async () => {
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(5)),
    ]);
    const result = await renderer.render(output, createTerminalOptions({ width: 96, noColor: true }));

    expect(result).not.toContain('\x1b[');
  });

  it('keeps visible lines within the requested width in full mode', async () => {
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(6)),
      createProvider('codex', 'Codex', createDailyUsageSequence(6, '2026-03-02', 2500)),
    ]);
    const result = await renderer.render(output, createTerminalOptions({ width: 96, noColor: true }));

    for (const line of result.split('\n')) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(96);
    }
  });

  it('keeps visible lines within the requested width at 80 columns', async () => {
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(6)),
      createProvider('codex', 'Codex', createDailyUsageSequence(6, '2026-03-02', 2500)),
    ]);
    const result = await renderer.render(output, createTerminalOptions({ width: 80, noColor: true }));

    for (const line of result.split('\n')) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(80);
    }
  });

  it('handles empty provider lists without crashing', async () => {
    const output = createOutput({
      providers: [],
      aggregated: createZeroedStats(),
      dateRange: { since: '2026-03-01', until: '2026-03-14' },
    });
    const result = await renderer.render(output, createTerminalOptions({ width: 96, noColor: true }));

    expect(result).toContain('No provider activity in the selected range.');
  });

  it('appends compare data for terminal compare runs', async () => {
    const deltas: CompareDeltas = {
      tokens: 15000,
      cost: 1.25,
      streak: 2,
      activeDays: 4,
      averageDailyTokens: 600,
      cacheHitRate: 0.12,
    };
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(6)),
    ]);
    output.more = {
      ...(output.more ?? {
        inputOutput: { inputPerOutput: null, outputPerInput: null, outputShare: 0 },
        monthlyBurn: { projectedTokens: 0, projectedCost: 0, observedDays: 0, calendarDays: 0 },
        cacheEconomics: { readTokens: 0, writeTokens: 0, readCoverage: 0, reuseRatio: null },
        hourOfDay: [],
        sessionMetrics: {
          totalSessions: 0,
          averageTokens: 0,
          averageCost: 0,
          averageMessages: 0,
          averageDurationMs: null,
          longestSession: null,
          projectCount: 0,
          topProject: null,
          projectBreakdown: [],
        },
        compare: null,
      }),
      compare: {
        previousRange: { since: '2026-02-15', until: '2026-02-28' },
        previousStats: aggregate(mergeProviderData([
          createProvider('claude-code', 'Claude Code', createDailyUsageSequence(4, '2026-02-15', 1200)),
        ]), '2026-02-28'),
        deltas,
        modelMixShift: [
          {
            model: 'claude-sonnet-4',
            currentShare: 0.62,
            previousShare: 0.41,
            deltaShare: 0.21,
            currentTokens: 24000,
            previousTokens: 12000,
          },
        ],
      },
    };

    const result = await renderer.render(output, createTerminalOptions({ width: 96, noColor: true }));

    expect(result).toContain('Overview');
    expect(result).toContain('Compare');
    expect(result).toContain('Model Mix Shift');
  });

  it('keeps compare data visible in compact mode', async () => {
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(6)),
    ]);
    output.more = {
      ...(output.more ?? {
        inputOutput: { inputPerOutput: null, outputPerInput: null, outputShare: 0 },
        monthlyBurn: { projectedTokens: 0, projectedCost: 0, observedDays: 0, calendarDays: 0 },
        cacheEconomics: { readTokens: 0, writeTokens: 0, readCoverage: 0, reuseRatio: null },
        hourOfDay: [],
        sessionMetrics: {
          totalSessions: 0,
          averageTokens: 0,
          averageCost: 0,
          averageMessages: 0,
          averageDurationMs: null,
          longestSession: null,
          projectCount: 0,
          topProject: null,
          projectBreakdown: [],
        },
        compare: null,
      }),
      compare: {
        previousRange: { since: '2026-02-15', until: '2026-02-28' },
        previousStats: createZeroedStats(),
        deltas: {
          tokens: 15000,
          cost: 1.25,
          streak: 2,
          activeDays: 4,
          averageDailyTokens: 600,
          cacheHitRate: 0.12,
        },
        modelMixShift: [],
      },
    };

    const result = await renderer.render(output, createTerminalOptions({ width: 50, noColor: true }));

    expect(result).toContain('Compare');
    expect(result).toContain('Total Tokens');
  });

  it('keeps compare data visible in oneliner mode', async () => {
    const output = createTerminalOutput([
      createProvider('claude-code', 'Claude Code', createDailyUsageSequence(6)),
    ]);
    output.more = {
      ...(output.more ?? {
        inputOutput: { inputPerOutput: null, outputPerInput: null, outputShare: 0 },
        monthlyBurn: { projectedTokens: 0, projectedCost: 0, observedDays: 0, calendarDays: 0 },
        cacheEconomics: { readTokens: 0, writeTokens: 0, readCoverage: 0, reuseRatio: null },
        hourOfDay: [],
        sessionMetrics: {
          totalSessions: 0,
          averageTokens: 0,
          averageCost: 0,
          averageMessages: 0,
          averageDurationMs: null,
          longestSession: null,
          projectCount: 0,
          topProject: null,
          projectBreakdown: [],
        },
        compare: null,
      }),
      compare: {
        previousRange: { since: '2026-02-15', until: '2026-02-28' },
        previousStats: createZeroedStats(),
        deltas: {
          tokens: 15000,
          cost: 1.25,
          streak: 2,
          activeDays: 4,
          averageDailyTokens: 600,
          cacheHitRate: 0.12,
        },
        modelMixShift: [],
      },
    };

    const result = await renderer.render(output, createTerminalOptions({ width: 28, noColor: true }));

    expect(result).toContain('Compare');
    expect(result).toContain('streak');
  });
});
