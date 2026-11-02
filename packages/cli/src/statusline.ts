import type { CostCompleteness, DailyUsage } from '@tokenleak/core';
import {
  buildDailyCostCompleteness,
  calculateStreaks,
  formatCostWithCompleteness,
  formatTokenCount,
  shiftDateStringLocal,
} from '@tokenleak/core';
import { bold, colorize256, dim } from '@tokenleak/renderers';

/** History loaded for the status line: enough to measure a long streak cheaply. */
export const STATUSLINE_HISTORY_DAYS = 60;
const WEEK_DAYS = 7;
const COST_COLOR = 179;
const SEPARATOR = ' · ';

export interface StatuslineSummary {
  today: { tokens: number; cost: number; completeness: CostCompleteness };
  week: { tokens: number; cost: number; completeness: CostCompleteness };
  streak: number;
}

function sum(days: readonly DailyUsage[]): { tokens: number; cost: number; completeness: CostCompleteness } {
  return {
    tokens: days.reduce((total, day) => total + day.totalTokens, 0),
    cost: days.reduce((total, day) => total + day.cost, 0),
    completeness: buildDailyCostCompleteness([...days]),
  };
}

/** Today, the trailing 7 days (including today), and the live streak. */
export function buildStatusline(daily: readonly DailyUsage[], today: string): StatuslineSummary {
  const weekStart = shiftDateStringLocal(today, -(WEEK_DAYS - 1));
  const active = daily.filter((day) => day.totalTokens > 0 || day.cost > 0);
  return {
    today: sum(active.filter((day) => day.date === today)),
    week: sum(active.filter((day) => day.date >= weekStart && day.date <= today)),
    streak: calculateStreaks([...active], today).current,
  };
}

/**
 * One line, short enough for an editor or tmux status bar:
 * `$42.10 today · $836 7d · 14d streak`.
 */
export function renderStatusline(summary: StatuslineSummary, options: { noColor: boolean }): string {
  const { noColor } = options;
  const today =
    summary.today.tokens === 0 && summary.today.cost === 0
      ? dim('no usage today', noColor)
      : `${colorize256(formatCostWithCompleteness(summary.today.cost, summary.today.completeness), COST_COLOR, noColor)} today ${dim(`(${formatTokenCount(summary.today.tokens)})`, noColor)}`;
  const parts = [
    today,
    `${bold(formatCostWithCompleteness(summary.week.cost, summary.week.completeness), noColor)} 7d`,
  ];
  if (summary.streak > 0) parts.push(`${summary.streak}d streak`);
  return parts.join(dim(SEPARATOR, noColor));
}
