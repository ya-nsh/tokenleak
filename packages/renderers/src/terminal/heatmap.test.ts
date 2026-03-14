import { describe, expect, it } from 'bun:test';
import { renderTerminalHeatmap } from './heatmap';
import { createDailyUsage } from '../__test-fixtures__';

describe('renderTerminalHeatmap', () => {
  it('renders a visible empty-cell grid in noColor mode', () => {
    const output = renderTerminalHeatmap(
      [
        createDailyUsage('2026-03-01', 1000),
        createDailyUsage('2026-03-03', 3000),
        createDailyUsage('2026-03-06', 5000),
      ],
      { width: 40, noColor: true },
    );

    expect(output).toContain('Mar 2026');
    expect(output).toContain('Sun');
    expect(output).toContain('·');
    expect(output).toContain('Less ·░▒▓█ More');
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
