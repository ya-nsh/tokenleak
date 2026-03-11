import type { DailyUsage } from '../types';

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
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const ONE_DAY_MS = 86_400_000;
  let longest = 1;
  let currentRun = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]!.date).getTime();
    const curr = new Date(sorted[i]!.date).getTime();
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
    const curr = new Date(sorted[i]!.date).getTime();
    const prev = new Date(sorted[i - 1]!.date).getTime();

    if (curr - prev === ONE_DAY_MS) {
      current++;
    } else {
      break;
    }
  }

  return { current, longest };
}
