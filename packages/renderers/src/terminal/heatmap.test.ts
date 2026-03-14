import { describe, expect, it } from 'bun:test';
import { renderTerminalHeatmap } from './heatmap';
import { createDailyUsage } from '../__test-fixtures__';
import { stripAnsi } from './layout';

function makeDailyRange(startDate: string, days: number, baseTokens = 1000): ReturnType<typeof createDailyUsage>[] {
  const result: ReturnType<typeof createDailyUsage>[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    result.push(createDailyUsage(`${yyyy}-${mm}-${dd}`, baseTokens + i * 500));
  }
  return result;
}

describe('renderTerminalHeatmap', () => {
  it('returns empty message for no data', () => {
    const output = renderTerminalHeatmap([], { width: 80, noColor: true });
    expect(output).toContain('No usage data');
  });

  it('shows Mon, Wed, Fri day labels (GitHub-style)', () => {
    const output = renderTerminalHeatmap(
      makeDailyRange('2026-01-05', 30),
      { width: 80, noColor: true },
    );
    expect(output).toContain('Mon');
    expect(output).toContain('Wed');
    expect(output).toContain('Fri');
  });

  it('does not show Sun, Tue, Thu, Sat as day labels', () => {
    const output = renderTerminalHeatmap(
      makeDailyRange('2026-01-05', 30),
      { width: 80, noColor: true },
    );
    const lines = output.split('\n');
    // Day label lines are the grid rows — check that none start with Sun/Tue/Thu/Sat
    for (const line of lines) {
      const trimmed = line.trimStart();
      expect(trimmed).not.toMatch(/^Sun\s/);
      expect(trimmed).not.toMatch(/^Tue\s/);
      expect(trimmed).not.toMatch(/^Thu\s/);
      expect(trimmed).not.toMatch(/^Sat\s/);
    }
  });

  it('renders Less/More legend', () => {
    const output = renderTerminalHeatmap(
      [createDailyUsage('2026-03-01', 1000)],
      { width: 40, noColor: true },
    );
    expect(output).toContain('Less');
    expect(output).toContain('More');
  });

  it('does not contain narrative text (Story, Pulse, Highlights)', () => {
    const output = renderTerminalHeatmap(
      makeDailyRange('2026-01-01', 60),
      { width: 80, noColor: true },
    );
    expect(output).not.toContain('Story');
    expect(output).not.toContain('Pulse');
    expect(output).not.toContain('Highlights');
  });

  it('uses double-char cells (██) in full mode', () => {
    const output = renderTerminalHeatmap(
      [createDailyUsage('2026-03-01', 5000)],
      { width: 80, noColor: true },
    );
    // Full mode cells are two block chars side by side
    expect(output).toMatch(/[·░▒▓█]{2}/);
  });

  it('compact mode at width < 40 uses single-char cells', () => {
    const output = renderTerminalHeatmap(
      [createDailyUsage('2026-03-01', 5000)],
      { width: 30, noColor: true },
    );
    const lines = output.split('\n');
    // In compact mode, grid rows should not have double blocks followed by space
    const gridLines = lines.filter((l) => l.match(/[·░▒▓█]/));
    for (const line of gridLines) {
      // Should not find "██ " pattern (full mode with gap)
      if (!line.includes('Less')) {
        // Compact cells are single char with no gap between them
        expect(line).not.toMatch(/[·░▒▓█]{2}\s[·░▒▓█]/);
      }
    }
  });

  it('keeps rows within the requested visible width', () => {
    const output = renderTerminalHeatmap(
      makeDailyRange('2026-01-01', 90),
      { width: 50, noColor: true },
    );
    for (const line of output.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(50);
    }
  });

  it('uses a caption for very narrow grids with single month', () => {
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

  it('renders month headers for multi-month data', () => {
    const output = renderTerminalHeatmap(
      makeDailyRange('2026-01-01', 60),
      { width: 80, noColor: true },
    );
    expect(output).toContain('Jan');
    expect(output).toContain('Feb');
  });

  it('renders heatmap blocks for usage data', () => {
    const output = renderTerminalHeatmap(
      [
        createDailyUsage('2026-03-01', 1000),
        createDailyUsage('2026-03-03', 3000),
        createDailyUsage('2026-03-06', 5000),
      ],
      { width: 40, noColor: true },
    );
    // Should contain actual block characters
    expect(output).toMatch(/[░▒▓█]/);
  });

  it('produces no ANSI escape codes in noColor mode', () => {
    const output = renderTerminalHeatmap(
      makeDailyRange('2026-01-01', 30),
      { width: 80, noColor: true },
    );
    expect(output).toBe(stripAnsi(output));
  });

  it('produces ANSI escape codes when color is enabled', () => {
    const output = renderTerminalHeatmap(
      makeDailyRange('2026-01-01', 30),
      { width: 80, noColor: false },
    );
    expect(output).not.toBe(stripAnsi(output));
  });

  it('has exactly 7 grid rows', () => {
    const output = renderTerminalHeatmap(
      makeDailyRange('2026-01-05', 14),
      { width: 80, noColor: true },
    );
    const lines = output.split('\n');
    // Grid rows contain block characters and are between header and legend
    const gridRows = lines.filter((l) =>
      l.match(/[·░▒▓█]/) && !l.includes('Less') && !l.includes('More'),
    );
    expect(gridRows.length).toBe(7);
  });
});
