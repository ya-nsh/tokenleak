/** One day in milliseconds */
export const ONE_DAY_MS = 86_400_000;

/**
 * Parse a YYYY-MM-DD date string to UTC milliseconds.
 * Appends T00:00:00Z to ensure UTC interpretation.
 */
export function dateToUtcMs(dateString: string): number {
  return new Date(dateString + 'T00:00:00Z').getTime();
}

/**
 * Format a Date object as YYYY-MM-DD using UTC.
 */
export function formatDateStringUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Sort comparator for DailyUsage-like objects with a `date` string field.
 */
export function compareDateStrings(a: string, b: string): number {
  return dateToUtcMs(a) - dateToUtcMs(b);
}
