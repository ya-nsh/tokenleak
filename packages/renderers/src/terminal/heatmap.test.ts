import { describe, expect, it } from 'bun:test';
import { renderTerminalHeatmap } from './heatmap';
import { createDailyUsage } from '../__test-fixtures__';

describe('renderTerminalHeatmap', () => {
  it('renders a visible big-cell grid and legends in noColor mode', () => {
    const output = renderTerminalHeatmap(
      [
        createDailyUsage('2026-03-01', 1000),
        createDailyUsage('2026-03-03', 3000),
        createDailyUsage('2026-03-06', 5000),
      ],
      { width: 64, noColor: true },
    );

    expect(output).toContain('Mar');
    expect(output).toContain('Sun');
    expect(output).toContain('██');
    expect(output).toContain('Intensity');
    expect(output).toContain('Models');
    expect(output).toContain('Claude');
    expect(output).toContain('Story');
    expect(output).toContain('Pulse');
    expect(output).toContain('\n\n  Intensity');
  });

  it('keeps rows within the requested visible width', () => {
    const output = renderTerminalHeatmap(
      [
        createDailyUsage('2026-01-01', 1000),
        createDailyUsage('2026-02-01', 2000),
        createDailyUsage('2026-03-01', 3000),
      ],
      { width: 24, noColor: true },
    );

    for (const line of output.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(24);
    }
  });

  it('shows multiple model-family labels when visible days use different families', () => {
    const output = renderTerminalHeatmap(
      [
        {
          ...createDailyUsage('2026-03-01', 1000),
          models: [{ ...createDailyUsage('2026-03-01', 1000).models[0]!, model: 'claude-3-opus' }],
        },
        {
          ...createDailyUsage('2026-03-02', 2000),
          models: [{ ...createDailyUsage('2026-03-02', 2000).models[0]!, model: 'gpt-4o' }],
        },
      ],
      { width: 48, noColor: true },
    );

    expect(output).toContain('Claude');
    expect(output).toContain('GPT');
  });

  it('uses the dominant model family palette for the intensity legend in color mode', () => {
    const output = renderTerminalHeatmap(
      [
        {
          ...createDailyUsage('2026-03-01', 1000),
          models: [{ ...createDailyUsage('2026-03-01', 1000).models[0]!, model: 'claude-3-opus' }],
        },
      ],
      { width: 64, noColor: false },
    );

    expect(output).toContain('\x1b[48;5;223m');
    expect(output).toContain('\x1b[48;5;215m');
    expect(output).toContain('\x1b[48;5;208m');
    expect(output).toContain('\x1b[48;5;166m');
  });

  it('uses a caption instead of ambiguous partial month labels on very short grids', () => {
    const output = renderTerminalHeatmap(
      [
        createDailyUsage('2026-06-15', 1000),
        createDailyUsage('2026-06-16', 2000),
        createDailyUsage('2026-06-17', 3000),
      ],
      { width: 16, noColor: true },
    );

    expect(output).toContain('Jun 2026');
  });
});
