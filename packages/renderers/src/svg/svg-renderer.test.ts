import { describe, expect, it } from 'bun:test';
import type {
  TokenleakOutput,
  RenderOptions,
  AggregatedStats,
  ProviderData,
  DailyUsage,
  DayOfWeekEntry,
  TopModelEntry,
} from '@tokenleak/core';
import { SCHEMA_VERSION } from '@tokenleak/core';
import { SvgRenderer } from './svg-renderer';

function createDayOfWeek(): DayOfWeekEntry[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.map((label, i) => ({
    day: i,
    label,
    tokens: (i + 1) * 1000,
    cost: (i + 1) * 0.01,
    count: i + 1,
  }));
}

function createTopModels(): TopModelEntry[] {
  return [
    { model: 'claude-3-opus', tokens: 50000, cost: 1.5, percentage: 50 },
    { model: 'claude-3-sonnet', tokens: 30000, cost: 0.6, percentage: 30 },
    { model: 'claude-3-haiku', tokens: 20000, cost: 0.1, percentage: 20 },
  ];
}

function createZeroedStats(): AggregatedStats {
  return {
    currentStreak: 0,
    longestStreak: 0,
    rolling30dTokens: 0,
    rolling30dCost: 0,
    rolling7dTokens: 0,
    rolling7dCost: 0,
    peakDay: null,
    averageDailyTokens: 0,
    averageDailyCost: 0,
    cacheHitRate: 0,
    totalTokens: 0,
    totalCost: 0,
    totalDays: 0,
    activeDays: 0,
    dayOfWeek: [],
    topModels: [],
  };
}

function createPopulatedStats(): AggregatedStats {
  return {
    currentStreak: 5,
    longestStreak: 12,
    rolling30dTokens: 80000,
    rolling30dCost: 3.2,
    rolling7dTokens: 20000,
    rolling7dCost: 0.8,
    peakDay: { date: '2026-03-01', tokens: 8000 },
    averageDailyTokens: 2500,
    averageDailyCost: 0.1,
    cacheHitRate: 0.42,
    totalTokens: 100000,
    totalCost: 4.0,
    totalDays: 40,
    activeDays: 30,
    dayOfWeek: createDayOfWeek(),
    topModels: createTopModels(),
  };
}

function createDailyUsage(date: string, totalTokens: number): DailyUsage {
  return {
    date,
    inputTokens: Math.floor(totalTokens * 0.6),
    outputTokens: Math.floor(totalTokens * 0.3),
    cacheReadTokens: Math.floor(totalTokens * 0.08),
    cacheWriteTokens: Math.floor(totalTokens * 0.02),
    totalTokens,
    cost: totalTokens * 0.00004,
    models: [
      {
        model: 'claude-3-opus',
        inputTokens: Math.floor(totalTokens * 0.6),
        outputTokens: Math.floor(totalTokens * 0.3),
        cacheReadTokens: Math.floor(totalTokens * 0.08),
        cacheWriteTokens: Math.floor(totalTokens * 0.02),
        totalTokens,
        cost: totalTokens * 0.00004,
      },
    ],
  };
}

function createProvider(name: string, displayName: string): ProviderData {
  return {
    provider: name,
    displayName,
    daily: [
      createDailyUsage('2026-03-01', 5000),
      createDailyUsage('2026-03-02', 3000),
      createDailyUsage('2026-03-03', 7000),
    ],
    totalTokens: 15000,
    totalCost: 0.6,
    colors: {
      primary: '#d97706',
      secondary: '#fbbf24',
      gradient: ['#d97706', '#fbbf24'],
    },
  };
}

function createOutput(overrides: Partial<TokenleakOutput> = {}): TokenleakOutput {
  return {
    schemaVersion: SCHEMA_VERSION,
    generated: '2026-03-11T00:00:00.000Z',
    dateRange: { since: '2026-01-01', until: '2026-03-11' },
    providers: [createProvider('claude-code', 'Claude Code')],
    aggregated: createPopulatedStats(),
    ...overrides,
  };
}

function createRenderOptions(overrides: Partial<RenderOptions> = {}): RenderOptions {
  return {
    format: 'svg',
    theme: 'dark',
    width: 800,
    showInsights: true,
    noColor: false,
    output: null,
    ...overrides,
  };
}

describe('SvgRenderer', () => {
  const renderer = new SvgRenderer();

  it('has format set to svg', () => {
    expect(renderer.format).toBe('svg');
  });

  it('output contains <svg opening tag', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    expect(result).toContain('<svg');
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('output contains provider names', async () => {
    const output = createOutput({
      providers: [
        createProvider('claude-code', 'Claude Code'),
        createProvider('codex', 'Codex'),
      ],
    });
    const result = await renderer.render(output, createRenderOptions());
    expect(result).toContain('Claude Code');
    expect(result).toContain('Codex');
  });

  it('dark vs light theme produces different backgrounds', async () => {
    const output = createOutput();
    const dark = await renderer.render(output, createRenderOptions({ theme: 'dark' }));
    const light = await renderer.render(output, createRenderOptions({ theme: 'light' }));

    // Dark theme uses #0d1117, light uses #ffffff
    expect(dark).toContain('#0d1117');
    expect(light).toContain('#ffffff');
    expect(dark).not.toContain('fill="#ffffff"');
    expect(light).not.toContain('fill="#0d1117"');
  });

  it('heatmap has rect elements for cells', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    // The heatmap should have rect elements with titles (tooltips)
    expect(result).toContain('<title>');
    expect(result).toContain('tokens</title>');
    // Should have multiple rect elements
    const rectCount = (result.match(/<rect /g) ?? []).length;
    // At least the background rect + some heatmap cells
    expect(rectCount).toBeGreaterThan(5);
  });

  it('stats text is present (streak, tokens)', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    expect(result).toContain('Current Streak');
    expect(result).toContain('Longest Streak');
    expect(result).toContain('Total Tokens');
    expect(result).toContain('Cache Hit Rate');
    expect(result).toContain('Statistics');
  });

  it('output is valid XML (properly closed tags)', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    // Check that the SVG starts with <svg and ends with </svg>
    expect(result.trim()).toMatch(/^<svg[\s\S]*<\/svg>$/);

    // Count opening and closing g tags
    const openG = (result.match(/<g[\s>]/g) ?? []).length;
    const closeG = (result.match(/<\/g>/g) ?? []).length;
    expect(openG).toBe(closeG);

    // Count opening and closing text tags
    const openText = (result.match(/<text[\s>]/g) ?? []).length;
    const closeText = (result.match(/<\/text>/g) ?? []).length;
    expect(openText).toBe(closeText);

    // All rect elements should be either self-closing (/>) or have a closing </rect>
    const selfClosingRects = (result.match(/<rect [^>]*\/>/g) ?? []).length;
    const pairedRects = (result.match(/<\/rect>/g) ?? []).length;
    expect(selfClosingRects + pairedRects).toBeGreaterThan(0);
  });

  it('empty providers still produces valid SVG', async () => {
    const output = createOutput({
      providers: [],
      aggregated: createZeroedStats(),
    });
    const result = await renderer.render(output, createRenderOptions());
    expect(result).toContain('<svg');
    expect(result).toContain('</svg>');
    expect(result).toContain('Tokenleak');
    expect(result).toContain('Statistics');
  });

  it('showInsights=false omits insights panel', async () => {
    const withInsights = await renderer.render(
      createOutput(),
      createRenderOptions({ showInsights: true }),
    );
    const withoutInsights = await renderer.render(
      createOutput(),
      createRenderOptions({ showInsights: false }),
    );

    expect(withInsights).toContain('Insights');
    expect(withoutInsights).not.toContain('Insights');
  });

  it('renders day of week chart when data is present', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    expect(result).toContain('Day of Week');
  });

  it('renders top models chart when data is present', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    expect(result).toContain('Top Models');
    expect(result).toContain('claude-3-opus');
  });

  it('escapes XML entities in provider names', async () => {
    const output = createOutput({
      providers: [createProvider('test', 'Test <Provider> & "More"')],
    });
    const result = await renderer.render(output, createRenderOptions());
    expect(result).toContain('&lt;Provider&gt;');
    expect(result).toContain('&amp;');
    expect(result).toContain('&quot;More&quot;');
    // Should NOT contain unescaped angle brackets in text content
    expect(result).not.toContain('>Test <Provider>');
  });
});
