import type { DailyUsage, DayOfWeekEntry } from '../types';

const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * Returns 7 entries (Sun-Sat) with aggregated tokens, cost, and count.
 */
export function dayOfWeekBreakdown(daily: DailyUsage[]): DayOfWeekEntry[] {
  const buckets: DayOfWeekEntry[] = DAY_LABELS.map((label, i) => ({
    day: i,
    label,
    tokens: 0,
    cost: 0,
    count: 0,
  }));

  for (const entry of daily) {
    const dayIndex = new Date(entry.date + 'T00:00:00').getUTCDay();
    const bucket = buckets[dayIndex]!;
    bucket.tokens += entry.totalTokens;
    bucket.cost += entry.cost;
    bucket.count += 1;
  }

  return buckets;
}
