import type { DailyUsage } from '../types';
import { ONE_DAY_MS, dateToUtcMs } from '../date-utils';

/**
 * Calculates current and longest streaks of consecutive days with usage.
 * A gap of 1+ days resets the streak; repeated dates count once.
 *
 * The current streak is still alive when the last active day is the
 * reference date or the day before it: today is not over, so a streak
 * should not read 0 at 00:01 just because today has no usage yet.
 */
export function calculateStreaks(
  daily: DailyUsage[],
  referenceDate: string,
): {
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

    if (diff === 0) {
      continue;
    }
    if (diff === ONE_DAY_MS) {
      currentRun++;
    } else {
      currentRun = 1;
    }

    if (currentRun > longest) {
      longest = currentRun;
    }
  }

  const referenceMs = dateToUtcMs(referenceDate);
  const lastActiveMs = dateToUtcMs(sorted[sorted.length - 1]!.date);
  const sinceLastActive = referenceMs - lastActiveMs;
  if (sinceLastActive !== 0 && sinceLastActive !== ONE_DAY_MS) {
    return { current: 0, longest };
  }

  // Current streak: count back from the reference date
  let current = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    const curr = dateToUtcMs(sorted[i]!.date);
    const prev = dateToUtcMs(sorted[i - 1]!.date);

    if (curr === prev) continue;
    if (curr - prev === ONE_DAY_MS) {
      current++;
    } else {
      break;
    }
  }

  return { current, longest };
}
