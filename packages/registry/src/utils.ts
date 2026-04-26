import type { DateRange } from '@tokenleak/core';

/**
 * Checks whether a YYYY-MM-DD date string falls within the given range (inclusive).
 * Uses lexicographic comparison which works correctly for ISO date strings.
 */
export function isInRange(date: string, range: DateRange): boolean {
  return date >= range.since && date <= range.until;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!);
      }
    }),
  );

  return results;
}
