import { describe, expect, it } from 'bun:test';
import { renderWrappedCard } from './wrapped';
import { renderBadge } from './badge';
import {
  createOutput,
  createPopulatedStats,
  createProvider,
} from '../__test-fixtures__';

describe('renderWrappedCard', () => {
  it('has viewBox 1200x630', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('viewBox="0 0 1200 630"');
  });

  it('has width 1200 and height 630', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
  });

  it('produces valid SVG with opening and closing tags', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg.trim()).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('includes Tokenleak Wrapped title', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('Tokenleak Wrapped');
  });

  it('includes tokenleak watermark', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('tokenleak');
  });

  it('includes streak count', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('5 days');
  });

  it('includes provider name', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('Claude Code');
  });

  it('includes date range', () => {
    const svg = renderWrappedCard(createOutput());
    expect(svg).toContain('2026-01-01');
    expect(svg).toContain('2026-03-11');
  });

  it('dark vs light theme produces different SVG', () => {
    const output = createOutput();
    const dark = renderWrappedCard(output, 'dark');
    const light = renderWrappedCard(output, 'light');
    expect(dark).not.toBe(light);
    expect(dark).toContain('#0d1117');
    expect(light).toContain('#ffffff');
  });

  it('handles empty providers gracefully', () => {
    const output = createOutput({
      providers: [],
      aggregated: createPopulatedStats({ currentStreak: 0 }),
    });
    const svg = renderWrappedCard(output);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
});

describe('renderBadge', () => {
  it('produces valid SVG', () => {
    const svg = renderBadge(createPopulatedStats());
    expect(svg.trim()).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('contains streak count text', () => {
    const svg = renderBadge(createPopulatedStats({ currentStreak: 7 }));
    expect(svg).toContain('7 days');
  });

  it('contains streak label', () => {
    const svg = renderBadge(createPopulatedStats());
    expect(svg).toContain('streak');
  });

  it('has prefers-color-scheme media query', () => {
    const svg = renderBadge(createPopulatedStats());
    expect(svg).toContain('prefers-color-scheme');
    expect(svg).toContain('prefers-color-scheme: dark');
    expect(svg).toContain('prefers-color-scheme: light');
  });

  it('updates value when streak changes', () => {
    const svg0 = renderBadge(createPopulatedStats({ currentStreak: 0 }));
    const svg42 = renderBadge(createPopulatedStats({ currentStreak: 42 }));
    expect(svg0).toContain('0 days');
    expect(svg42).toContain('42 days');
  });

  it('has <style> element', () => {
    const svg = renderBadge(createPopulatedStats());
    expect(svg).toContain('<style>');
    expect(svg).toContain('</style>');
  });
});
