import type { DateRange } from '@tokenleak/core';

/**
 * Checks whether a YYYY-MM-DD date string falls within the given range (inclusive).
 * Uses lexicographic comparison which works correctly for ISO date strings.
 */
export function isInRange(date: string, range: DateRange): boolean {
  return date >= range.since && date <= range.until;
}
