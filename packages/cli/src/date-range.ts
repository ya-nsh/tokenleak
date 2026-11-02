import { DEFAULT_DAYS, getTodayLocal, shiftDateStringLocal } from '@tokenleak/core';
import type { DateRange } from '@tokenleak/core';
import { TokenleakError } from './errors.js';

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** Validate that a date string is YYYY-MM-DD and represents a real date. */
export function isValidDate(dateStr: string): boolean {
  if (!DATE_FORMAT.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

const RELATIVE_DAYS: Readonly<Record<string, number>> = { today: 0, yesterday: -1 };

/**
 * Resolve a single-day argument (`2026-03-10`, `today`, `yesterday`) for
 * commands like explain and replay, with an error that says what was wrong.
 */
export function resolveDayArgument(command: string, value: string): string {
  const relative = RELATIVE_DAYS[value.toLowerCase()];
  if (relative !== undefined) return shiftDateStringLocal(getTodayLocal(), relative);
  if (isValidDate(value)) return value;
  const reason = DATE_FORMAT.test(value) ? 'is not a real calendar date' : 'is not in YYYY-MM-DD format';
  throw new TokenleakError(
    `${command}: "${value}" ${reason}. Use YYYY-MM-DD, "today", or "yesterday".`,
  );
}

/** Compute the date range from CLI-style inputs. */
export function computeDateRange(args: {
  since?: string;
  until?: string;
  days?: number;
}): DateRange {
  const until = args.until ?? getTodayLocal();

  if (args.until && !isValidDate(args.until)) {
    throw new TokenleakError(
      `Invalid --until date: "${args.until}". Use YYYY-MM-DD format.`,
    );
  }

  if (args.since && !isValidDate(args.since)) {
    throw new TokenleakError(
      `Invalid --since date: "${args.since}". Use YYYY-MM-DD format.`,
    );
  }

  let since: string;

  if (args.since) {
    since = args.since;
  } else {
    const daysBack = args.days ?? DEFAULT_DAYS;
    since = shiftDateStringLocal(until, -(daysBack - 1));
  }

  if (since > until) {
    throw new TokenleakError(
      `--since (${since}) must not be after --until (${until}).`,
    );
  }

  return { since, until };
}
