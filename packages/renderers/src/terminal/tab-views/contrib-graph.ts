import type { TokenleakOutput } from '@tokenleak/core';
import { colorize256, background256, dim, bold } from '../colors';

const WEEKS = 52;
const DAYS_PER_WEEK = 7;
const BLOCK = '\u2588';
const EMPTY_BLOCK = '\u2591';

/** 5-grade intensity using 256-color codes. */
const DEFAULT_GRADES: number[] = [
  235, // near-black (no activity)
  22,  // dark green
  28,  // medium green
  34,  // green
  46,  // bright green
];

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Renders a 52-week GitHub-style contribution graph.
 * Each cell represents one day, colored by activity intensity.
 */
export function renderContribGraph(
  output: TokenleakOutput,
  width: number,
  noColor: boolean,
  grades: number[] = DEFAULT_GRADES,
): string {
  // Merge daily data from all providers
  const allDaily = output.providers.flatMap((p) => p.daily);
  if (allDaily.length === 0) {
    return dim('  No daily data available for contribution graph.', noColor);
  }

  // Build a map of date → token count (sum across providers)
  const dateMap = new Map<string, number>();
  let maxTokens = 0;
  for (const day of allDaily) {
    const total = day.totalTokens;
    const prev = dateMap.get(day.date) ?? 0;
    const sum = prev + total;
    dateMap.set(day.date, sum);
    if (sum > maxTokens) maxTokens = sum;
  }

  // Determine end date (most recent data point or until)
  const endDate = new Date(output.dateRange.until + 'T00:00:00Z');
  // Align to the end of the week (Saturday)
  const endDow = endDate.getUTCDay();
  const daysToSaturday = (6 - endDow + 7) % 7;
  endDate.setUTCDate(endDate.getUTCDate() + daysToSaturday);

  // Generate the grid: weeks × days
  const totalDays = WEEKS * DAYS_PER_WEEK;
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - totalDays + 1);

  // Quantile thresholds for grading
  const thresholds = maxTokens > 0
    ? [0, maxTokens * 0.25, maxTokens * 0.5, maxTokens * 0.75, maxTokens]
    : [0, 1, 2, 3, 4];

  function getGrade(tokens: number): number {
    if (tokens === 0) return 0;
    for (let i = thresholds.length - 1; i >= 1; i--) {
      if (tokens >= thresholds[i - 1]!) return Math.min(i, grades.length - 1);
    }
    return 1;
  }

  // Build grid[week][day]
  const grid: number[][] = [];
  const monthStarts: { week: number; month: number }[] = [];
  let lastMonth = -1;

  for (let w = 0; w < WEEKS; w++) {
    const week: number[] = [];
    for (let d = 0; d < DAYS_PER_WEEK; d++) {
      const dayOffset = w * DAYS_PER_WEEK + d;
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + dayOffset);
      const dateStr = date.toISOString().slice(0, 10);
      const tokens = dateMap.get(dateStr) ?? 0;
      week.push(getGrade(tokens));

      // Track month boundaries
      const month = date.getUTCMonth();
      if (month !== lastMonth) {
        monthStarts.push({ week: w, month });
        lastMonth = month;
      }
    }
    grid.push(week);
  }

  // Render month labels row
  const labelWidth = 5; // "Mon  " prefix
  const maxWeeks = Math.min(WEEKS, Math.floor((width - labelWidth) / 2));
  const monthRow: string[] = new Array(maxWeeks).fill('  ');
  for (const { week, month } of monthStarts) {
    if (week < maxWeeks && week + 2 < maxWeeks) {
      const label = MONTH_LABELS[month]!;
      monthRow[week] = label.slice(0, 2);
      if (label.length > 2 && week + 1 < maxWeeks) {
        monthRow[week + 1] = label.slice(2, 3) + ' ';
      }
    }
  }

  const lines: string[] = [];
  lines.push(bold('  Contribution Graph', noColor));
  lines.push('');

  // Month labels
  const monthLine = ' '.repeat(labelWidth) + monthRow.slice(0, maxWeeks).join('');
  lines.push(dim(monthLine, noColor));

  // Each row = one day of the week (Sun=0 through Sat=6)
  for (let d = 0; d < DAYS_PER_WEEK; d++) {
    const dayLabel = (DAY_LABELS[d] ?? '').padEnd(labelWidth - 1) + ' ';
    const cells: string[] = [];

    for (let w = 0; w < maxWeeks; w++) {
      const grade = grid[w]?.[d] ?? 0;
      const colorCode = grades[grade] ?? grades[0]!;
      if (noColor) {
        cells.push(grade === 0 ? EMPTY_BLOCK + ' ' : BLOCK + ' ');
      } else {
        cells.push(colorize256(BLOCK + ' ', colorCode, false));
      }
    }

    lines.push(dim(dayLabel, noColor) + cells.join(''));
  }

  // Legend
  lines.push('');
  const legendCells = grades.map((code, i) => {
    if (noColor) return i === 0 ? EMPTY_BLOCK : BLOCK;
    return colorize256(BLOCK, code, false);
  });
  lines.push(`${' '.repeat(labelWidth)}Less ${legendCells.join(' ')} More`);

  return lines.join('\n');
}
