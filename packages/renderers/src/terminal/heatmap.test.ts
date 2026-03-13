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

    expect(output).toContain('M');
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
});
