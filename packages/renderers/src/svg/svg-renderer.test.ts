import { describe, expect, it } from 'bun:test';
import { SvgRenderer } from './svg-renderer';
import {
  createDailyUsage,
  createOutput,
  createPopulatedStats,
  createProvider,
  createRenderOptions,
  createZeroedStats,
} from '../__test-fixtures__';

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
    expect(result).toContain('CURRENT STREAK');
    expect(result).toContain('LONGEST STREAK');
    expect(result).toContain('TOTAL TOKENS');
    expect(result).toContain('CACHE HIT RATE');
    expect(result).toContain('MOST USED MODEL');
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
    expect(result).toContain('TOTAL TOKENS');
  });

  it('renders bottom stat cards with model info', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    expect(result).toContain('MOST USED MODEL');
    expect(result).toContain('claude-3-opus');
    expect(result).toContain('RECENT USE');
    expect(result).toContain('TOTAL COST');
    expect(result).toContain('ACTIVE DAYS');
    expect(result).toContain('AVG DAILY TOKENS');
  });

  it('renders header token stats', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    expect(result).toContain('INPUT TOKENS');
    expect(result).toContain('OUTPUT TOKENS');
    expect(result).toContain('TOTAL TOKENS');
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
