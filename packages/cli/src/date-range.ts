import { DEFAULT_DAYS } from '@tokenleak/core';
import type { DateRange } from '@tokenleak/core';
import { TokenleakError } from './errors.js';

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** Validate that a date string is YYYY-MM-DD and represents a real date. */
export function isValidDate(dateStr: string): boolean {
  if (!DATE_FORMAT.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

/** Compute the date range from CLI-style inputs. */
export function computeDateRange(args: {
  since?: string;
  until?: string;
  days?: number;
}): DateRange {
  const until = args.until ?? new Date().toISOString().slice(0, 10);

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
    const d = new Date(until);
    d.setDate(d.getDate() - daysBack);
    since = d.toISOString().slice(0, 10);
  }

  if (since > until) {
    throw new TokenleakError(
      `--since (${since}) must not be after --until (${until}).`,
    );
  }

  return { since, until };
}
