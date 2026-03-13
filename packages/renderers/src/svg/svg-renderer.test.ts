import { describe, expect, it } from 'bun:test';
import { SvgRenderer } from './svg-renderer';
import { renderTerminalCardSvg } from '../png/terminal-card';
import {
  createOutput,
  createProvider,
  createRenderOptions,
  createZeroedStats,
} from '../__test-fixtures__';

describe('SvgRenderer', () => {
  const renderer = new SvgRenderer();

  it('has format set to svg', () => {
    expect(renderer.format).toBe('svg');
  });

  it('renders the terminal-card svg shell', async () => {
    const output = createOutput();
    const options = createRenderOptions();
    const result = await renderer.render(output, options);
    expect(result).toContain('<svg');
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result).toContain('tokenleak');
    expect(result).toContain('TOP MODELS');
    expect(result).toBe(renderTerminalCardSvg(output, { ...options, format: 'svg' }));
  });

  it('matches the png card theme palette', async () => {
    const output = createOutput();
    const dark = await renderer.render(output, createRenderOptions({ theme: 'dark' }));
    const light = await renderer.render(output, createRenderOptions({ theme: 'light' }));

    expect(dark).toContain('#09090b');
    expect(light).toContain('#fafafa');
    expect(dark).toContain('optimizeLegibility');
    // Single provider: accent derives from provider primary, not theme green
    expect(light).toContain('#d97706');
  });

  it('includes provider sections and top model percentages', async () => {
    const output = createOutput({
      providers: [
        createProvider('claude-code', 'Claude Code'),
        createProvider('codex', 'Codex'),
      ],
    });
    const result = await renderer.render(output, createRenderOptions());

    expect(result).toContain('Claude Code');
    expect(result).toContain('Codex');
    expect(result).toContain('50%');
    expect(result).toContain('30%');
  });

  it('renders valid XML with multiple rects', async () => {
    const result = await renderer.render(createOutput(), createRenderOptions());
    expect(result.trim()).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect((result.match(/<rect /g) ?? []).length).toBeGreaterThan(10);
    expect((result.match(/<text /g) ?? []).length).toBeGreaterThan(10);
  });

  it('handles empty data without crashing', async () => {
    const output = createOutput({
      providers: [],
      aggregated: createZeroedStats(),
    });
    const result = await renderer.render(output, createRenderOptions());

    expect(result).toContain('No provider data');
    expect(result).toContain('0 days');
    expect(result).toContain('0.0%');
  });

  it('escapes provider names safely', async () => {
    const output = createOutput({
      providers: [createProvider('test', 'Test <Provider> & "More"')],
    });
    const result = await renderer.render(output, createRenderOptions());

    expect(result).toContain('&lt;Provider&gt;');
    expect(result).toContain('&amp;');
    expect(result).toContain('&quot;More&quot;');
  });
});
