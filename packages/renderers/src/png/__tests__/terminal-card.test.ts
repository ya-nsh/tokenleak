import { describe, expect, it } from 'bun:test';
import { renderTerminalCardSvg } from '../terminal-card';
import {
  createOutput,
  createRenderOptions,
  createZeroedStats,
} from '../../__test-fixtures__';

describe('renderTerminalCardSvg', () => {
  const output = createOutput();
  const options = createRenderOptions({ format: 'png', theme: 'dark' });

  it('produces valid SVG output', () => {
    const svg = renderTerminalCardSvg(output, options);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('contains traffic light dots with correct colors', () => {
    const svg = renderTerminalCardSvg(output, options);
    expect(svg).toContain('#ff5f57');
    expect(svg).toContain('#febc2e');
    expect(svg).toContain('#28c840');
    // Three circle elements
    const circleCount = (svg.match(/<circle/g) ?? []).length;
    expect(circleCount).toBe(3);
  });

  it('contains "tokenleak" title text', () => {
    const svg = renderTerminalCardSvg(output, options);
    expect(svg).toContain('tokenleak');
  });

  it('contains the command prompt $ tokenleak', () => {
    const svg = renderTerminalCardSvg(output, options);
    expect(svg).toContain('$');
    expect(svg).toContain('tokenleak');
  });

  it('contains date range text', () => {
    const svg = renderTerminalCardSvg(output, options);
    // Output date range is JAN 2026 — MAR 2026
    expect(svg).toContain('JAN');
    expect(svg).toContain('MAR');
    expect(svg).toContain('DAYS');
  });

  it('contains heatmap cells (rect elements with heatmap colors)', () => {
    const svg = renderTerminalCardSvg(output, options);
    // Should have rect elements for heatmap cells
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    expect(rectCount).toBeGreaterThan(10); // Background + heatmap cells + bars
  });

  it('shows all 6 stats', () => {
    const svg = renderTerminalCardSvg(output, options);
    expect(svg).toContain('CURRENT STREAK');
    expect(svg).toContain('LONGEST STREAK');
    expect(svg).toContain('TOTAL TOKENS');
    expect(svg).toContain('TOTAL COST');
    expect(svg).toContain('30-DAY TOKENS');
    expect(svg).toContain('CACHE HIT RATE');
  });

  it('shows top models section with model names and bars', () => {
    const svg = renderTerminalCardSvg(output, options);
    expect(svg).toContain('TOP MODELS');
    expect(svg).toContain('claude-3-opus');
    expect(svg).toContain('claude-3-sonnet');
    expect(svg).toContain('claude-3-haiku');
    // Percentage bars (linearGradient elements)
    expect(svg).toContain('linearGradient');
  });

  it('light theme uses light theme colors', () => {
    const lightOptions = createRenderOptions({ format: 'png', theme: 'light' });
    const svg = renderTerminalCardSvg(output, lightOptions);
    // Light theme background
    expect(svg).toContain('#fafafa');
    // Light theme accent
    expect(svg).toContain('#059669');
  });

  it('empty data produces a valid card with zeroed stats', () => {
    const emptyOutput = createOutput({
      providers: [],
      aggregated: createZeroedStats(),
    });
    const svg = renderTerminalCardSvg(emptyOutput, options);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('CURRENT STREAK');
    expect(svg).toContain('0 days');
    expect(svg).toContain('0.0%');
  });

  it('dark theme uses dark theme colors', () => {
    const svg = renderTerminalCardSvg(output, options);
    expect(svg).toContain('#0c0c0c');
    expect(svg).toContain('#10b981');
  });
});
