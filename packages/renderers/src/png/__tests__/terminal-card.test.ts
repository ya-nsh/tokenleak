import { describe, expect, it } from 'bun:test';
import { renderTerminalCardSvg } from '../terminal-card';
import {
  createOutput,
  createRenderOptions,
  createZeroedStats,
  createProvider,
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
    // 3 traffic light dots + 1 provider dot = 4 circles minimum
    const circleCount = (svg.match(/<circle/g) ?? []).length;
    expect(circleCount).toBeGreaterThanOrEqual(3);
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
    expect(svg).toContain('JAN');
    expect(svg).toContain('MAR');
    expect(svg).toContain('DAYS');
  });

  it('contains heatmap cells (rect elements)', () => {
    const svg = renderTerminalCardSvg(output, options);
    const rectCount = (svg.match(/<rect /g) ?? []).length;
    expect(rectCount).toBeGreaterThan(10);
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
    expect(svg).toContain('linearGradient');
  });

  it('light theme uses light theme colors', () => {
    const lightOptions = createRenderOptions({ format: 'png', theme: 'light' });
    const svg = renderTerminalCardSvg(output, lightOptions);
    expect(svg).toContain('#fafafa');
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
    expect(svg).toContain('No provider data');
  });

  it('dark theme uses dark theme colors', () => {
    const svg = renderTerminalCardSvg(output, options);
    expect(svg).toContain('#09090b');
    expect(svg).toContain('#10b981');
  });

  // ── Per-provider / multi-provider tests ─────────────────────────────

  it('shows provider display name with colored dot', () => {
    const svg = renderTerminalCardSvg(output, options);
    // Default fixture has one provider: "Claude Code"
    expect(svg).toContain('Claude Code');
    // Provider dot color from fixture (#d97706)
    expect(svg).toContain('#d97706');
  });

  it('shows per-provider token and cost summary', () => {
    const svg = renderTerminalCardSvg(output, options);
    // Fixture provider has 15000 tokens and $0.60
    expect(svg).toContain('15.0K tokens');
  });

  it('renders multiple providers stacked vertically', () => {
    const multiOutput = createOutput({
      providers: [
        createProvider('claude-code', 'Claude Code'),
        createProvider('codex', 'Codex'),
      ],
    });
    const svg = renderTerminalCardSvg(multiOutput, options);

    // Both provider names present
    expect(svg).toContain('Claude Code');
    expect(svg).toContain('Codex');

    // Should have divider line between providers (multiple line elements)
    const lineCount = (svg.match(/<line /g) ?? []).length;
    expect(lineCount).toBeGreaterThanOrEqual(3); // titlebar border + provider divider + stats dividers
  });

  it('shows OVERALL label when multiple providers exist', () => {
    const multiOutput = createOutput({
      providers: [
        createProvider('claude-code', 'Claude Code'),
        createProvider('codex', 'Codex'),
      ],
    });
    const svg = renderTerminalCardSvg(multiOutput, options);
    expect(svg).toContain('OVERALL');
  });

  it('does not show OVERALL label with single provider', () => {
    const svg = renderTerminalCardSvg(output, options);
    expect(svg).not.toContain('OVERALL');
  });

  it('renders three providers with distinct colored dots', () => {
    const threeProviders = createOutput({
      providers: [
        {
          ...createProvider('claude-code', 'Claude Code'),
          colors: { primary: '#ff6b35', secondary: '#ffa366', gradient: ['#ff6b35', '#ffa366'] as [string, string] },
        },
        {
          ...createProvider('codex', 'Codex'),
          colors: { primary: '#10a37f', secondary: '#4ade80', gradient: ['#10a37f', '#4ade80'] as [string, string] },
        },
        {
          ...createProvider('open-code', 'Open Code'),
          colors: { primary: '#6366f1', secondary: '#a78bfa', gradient: ['#6366f1', '#a78bfa'] as [string, string] },
        },
      ],
    });
    const svg = renderTerminalCardSvg(threeProviders, options);

    expect(svg).toContain('Claude Code');
    expect(svg).toContain('Codex');
    expect(svg).toContain('Open Code');

    // All three provider primary colors should appear
    expect(svg).toContain('#ff6b35');
    expect(svg).toContain('#10a37f');
    expect(svg).toContain('#6366f1');

    // 3 traffic light dots + 3 provider dots = 6 circles
    const circleCount = (svg.match(/<circle/g) ?? []).length;
    expect(circleCount).toBe(6);
  });

  it('each provider gets its own heatmap section', () => {
    const multiOutput = createOutput({
      providers: [
        createProvider('claude-code', 'Claude Code'),
        createProvider('codex', 'Codex'),
      ],
    });
    const svg = renderTerminalCardSvg(multiOutput, options);

    // Each provider heatmap is wrapped in a <g transform="translate(...)">
    // so we should see at least 2 heatmap groups
    const groupTranslateCount = (svg.match(/<g transform="translate\(/g) ?? []).length;
    expect(groupTranslateCount).toBeGreaterThanOrEqual(2);
  });
});
