import type { DateRange } from '@tokenleak/core';
import { DEFAULT_DAYS, formatDateStringUtc, ONE_DAY_MS } from '@tokenleak/core';

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
  const now = new Date();
  const untilDate = args.until ?? formatDateStringUtc(now);
  const days = args.days ?? defaultDays;

  if (args.since) {
    return { since: args.since, until: untilDate };
  }

  const sinceMs = Date.parse(`${untilDate}T00:00:00Z`) - (days - 1) * ONE_DAY_MS;
  const sinceDate = formatDateStringUtc(new Date(sinceMs));

  return { since: sinceDate, until: untilDate };
}
