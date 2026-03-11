import type { DailyUsage } from '../types';
import { ONE_DAY_MS, dateToUtcMs } from '../date-utils';

/**
 * Calculates current and longest streaks of consecutive days with usage.
 * Days must be sorted by date. A gap of 1+ days resets the streak.
 * Current streak counts back from the most recent day.
 */
export function calculateStreaks(daily: DailyUsage[]): {
  current: number;
  longest: number;
} {
  if (daily.length === 0) {
    return { current: 0, longest: 0 };
  }

  const sorted = [...daily].sort(
    (a, b) => dateToUtcMs(a.date) - dateToUtcMs(b.date),
  );

  let longest = 1;
  let currentRun = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = dateToUtcMs(sorted[i - 1]!.date);
    const curr = dateToUtcMs(sorted[i]!.date);
    const diff = curr - prev;

    if (diff === ONE_DAY_MS) {
      currentRun++;
    } else {
      currentRun = 1;
    }

    if (currentRun > longest) {
      longest = currentRun;
    }
  }

  // Current streak: count back from the last day
  let current = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    const curr = dateToUtcMs(sorted[i]!.date);
    const prev = dateToUtcMs(sorted[i - 1]!.date);

    if (curr - prev === ONE_DAY_MS) {
      current++;
    } else {
      break;
    }
  }

  return { current, longest };
}
