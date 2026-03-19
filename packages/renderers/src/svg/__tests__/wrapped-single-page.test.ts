import { describe, expect, it } from 'bun:test';
import { renderWrappedSinglePageSvg } from '../wrapped-single-page';
import {
  createOutput,
  createPopulatedStats,
  createProvider,
  createMoreStats,
  createZeroedStats,
} from '../../__test-fixtures__';

describe('renderWrappedSinglePageSvg', () => {
  it('generates valid SVG with opening and closing tags', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg.trim()).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('has width 1200', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('width="1200"');
  });

  it('includes title text AI Wrapped', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('AI Wrapped');
  });

  it('includes date range year', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('2026');
  });

  it('includes TokenLeak branding', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('TokenLeak');
  });

  it('includes big numbers section', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('THE BIG NUMBERS');
  });

  it('includes streak section', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('STREAK');
  });

  it('includes cache section', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('CACHE');
  });

  it('includes provider mix section', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('PROVIDER MIX');
  });

  it('includes achievements section', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('ACHIEVEMENTS');
  });

  it('includes coding days section', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('CODING DAYS');
  });

  it('includes peak day section', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('PEAK DAY');
  });

  it('includes when you code section', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('WHEN YOU CODE');
  });

  it('includes top models section', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('YOUR TOP MODELS');
  });

  it('renders with populated stats and more data', () => {
    const svg = renderWrappedSinglePageSvg(createOutput({ more: createMoreStats() }));
    expect(svg).toContain('<svg');
    expect(svg).toContain('CACHE');
    expect(svg).toContain('HIT RATE');
  });

  it('renders cache economics when more stats are present', () => {
    const svg = renderWrappedSinglePageSvg(createOutput({ more: createMoreStats() }));
    expect(svg).toContain('Reads:');
    expect(svg).toContain('Writes:');
    expect(svg).toContain('Reuse:');
  });

  it('renders with zeroed stats without crashing', () => {
    const svg = renderWrappedSinglePageSvg(
      createOutput({ aggregated: createZeroedStats(), providers: [], more: null }),
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders with single provider', () => {
    const svg = renderWrappedSinglePageSvg(
      createOutput({ providers: [createProvider('claude-code', 'Claude Code')] }),
    );
    expect(svg).toContain('Claude Code');
  });

  it('renders with multiple providers', () => {
    const svg = renderWrappedSinglePageSvg(
      createOutput({
        providers: [
          createProvider('claude-code', 'Claude Code'),
          createProvider('codex', 'Codex'),
          createProvider('pi', 'Pi'),
        ],
      }),
    );
    expect(svg).toContain('Claude Code');
    expect(svg).toContain('Codex');
    expect(svg).toContain('Pi');
  });

  it('renders peak day when present', () => {
    const svg = renderWrappedSinglePageSvg(
      createOutput({
        aggregated: createPopulatedStats({
          peakDay: { date: '2026-03-14', tokens: 87432 },
        }),
      }),
    );
    expect(svg).toContain('PEAK DAY');
    expect(svg).toContain('TOKENS IN ONE DAY');
  });

  it('renders gracefully without peak day', () => {
    const svg = renderWrappedSinglePageSvg(
      createOutput({
        aggregated: createPopulatedStats({ peakDay: null }),
      }),
    );
    expect(svg).toContain('No peak day data');
  });

  it('renders projection with monthly burn data', () => {
    const svg = renderWrappedSinglePageSvg(
      createOutput({ more: createMoreStats() }),
    );
    expect(svg).toContain('PROJECTED / MONTH');
  });

  it('renders projection without more stats (fallback)', () => {
    const svg = renderWrappedSinglePageSvg(
      createOutput({ more: null }),
    );
    expect(svg).toContain('PROJECTED / MONTH');
  });

  it('renders all badge titles in achievements section', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('Streak Master');
    expect(svg).toContain('Night Owl');
    expect(svg).toContain('Big Spender');
    expect(svg).toContain('Cache Master');
    expect(svg).toContain('Daily Driver');
    expect(svg).toContain('Power User');
    expect(svg).toContain('Summit Day');
    expect(svg).toContain('Multi-Tool');
    expect(svg).toContain('Early Bird');
    expect(svg).toContain('Model Hopper');
  });

  it('outputs a noise filter for texture', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('feTurbulence');
    expect(svg).toContain('fractalNoise');
  });

  it('uses the gold accent color', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('#d4af5f');
  });

  it('uses the dark background color', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    expect(svg).toContain('#09090b');
  });

  it('includes time of day data from hourOfDay', () => {
    const output = createOutput({
      more: createMoreStats({
        hourOfDay: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          tokens: (hour >= 22 || hour < 6) ? 8000 : 500,
          cost: 0.1,
          count: 1,
        })),
      }),
    });
    const svg = renderWrappedSinglePageSvg(output);
    expect(svg).toContain('WHEN YOU CODE');
  });

  it('has height greater than 0', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    const match = svg.match(/height="(\d+)"/);
    expect(match).toBeTruthy();
    const height = parseInt(match![1]!, 10);
    expect(height).toBeGreaterThan(0);
  });

  it('height is reasonable for single page (under 2000px)', () => {
    const svg = renderWrappedSinglePageSvg(createOutput());
    const match = svg.match(/viewBox="0 0 1200 (\d+)"/);
    expect(match).toBeTruthy();
    const height = parseInt(match![1]!, 10);
    expect(height).toBeLessThan(2000);
    expect(height).toBeGreaterThan(500);
  });
});
