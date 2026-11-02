/** One day in milliseconds */
export const ONE_DAY_MS = 86_400_000;

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

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
 * Format a Date object as YYYY-MM-DD using the local timezone.
 */
export function formatDateStringLocal(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The local calendar day (YYYY-MM-DD) an instant falls on, or null when it
 * cannot be parsed. Usage is bucketed by the user's day, the same way ranges
 * and "today" are, so work after local midnight is not filed under
 * yesterday for anyone east of UTC (or tomorrow for anyone west).
 *
 * Date-only strings are already calendar days and are returned as written
 * (after validation) instead of being shifted through UTC midnight.
 */
export function localDateOfTimestamp(timestamp: string | number | Date): string | null {
  if (typeof timestamp === 'string' && DATE_ONLY.test(timestamp.trim())) {
    const day = timestamp.trim();
    const parsed = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
  }
  const millis = timestamp instanceof Date ? timestamp.getTime() : typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  return Number.isFinite(millis) ? formatDateStringLocal(new Date(millis)) : null;
}

/**
 * Return today's local calendar date as YYYY-MM-DD.
 */
export function getTodayLocal(): string {
  return formatDateStringLocal(new Date());
}

/**
 * Shift a YYYY-MM-DD string by a number of calendar days in local time.
 */
export function shiftDateStringLocal(dateString: string, offsetDays: number): string {
  const [year, month, day] = dateString.split('-').map((part) => Number(part));
  const shifted = new Date(year, (month ?? 1) - 1, day ?? 1);
  shifted.setDate(shifted.getDate() + offsetDays);
  return formatDateStringLocal(shifted);
}

/**
 * Return the inclusive number of calendar days between two YYYY-MM-DD strings.
 */
export function inclusiveDaySpan(since: string, until: string): number {
  return Math.round((dateToUtcMs(until) - dateToUtcMs(since)) / ONE_DAY_MS) + 1;
}

/**
 * Sort comparator for DailyUsage-like objects with a `date` string field.
 */
export function compareDateStrings(a: string, b: string): number {
  return dateToUtcMs(a) - dateToUtcMs(b);
}
