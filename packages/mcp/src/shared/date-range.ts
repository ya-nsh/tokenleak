import type { DateRange } from '@tokenleak/core';
import { DEFAULT_DAYS, getTodayLocal, shiftDateStringLocal } from '@tokenleak/core';

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(date: string): boolean {
  if (!DATE_FORMAT.test(date)) {
    return false;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function assertValidDate(label: 'since' | 'until', date: string): void {
  if (!isValidDate(date)) {
    throw new Error(`Invalid ${label} date: "${date}". Use YYYY-MM-DD format.`);
  }
}

export function validateRange(range: DateRange): DateRange {
  assertValidDate('since', range.since);
  assertValidDate('until', range.until);
  if (range.since > range.until) {
    throw new Error('since must not be after until');
  }
  return range;
}

/**
 * Resolve a date range from optional `days`, `since`, and `until` parameters.
 * - If `since` and `until` are both provided, use them directly.
 * - If only `since` is provided, `until` defaults to today.
 * - If only `until` is provided, `since` defaults to `until - days`.
 * - If neither is provided, use `days` (defaulting to the given fallback) ending today.
 */
export function resolveRange(
  args: { days?: number; since?: string; until?: string },
  defaultDays: number = DEFAULT_DAYS,
): DateRange {
  const untilDate = args.until ?? getTodayLocal();
  const days = args.days ?? defaultDays;

  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('days must be a positive number');
  }

  assertValidDate('until', untilDate);

  if (args.since) {
    return validateRange({ since: args.since, until: untilDate });
  }

  const sinceDate = shiftDateStringLocal(untilDate, -(days - 1));

  return { since: sinceDate, until: untilDate };
}
