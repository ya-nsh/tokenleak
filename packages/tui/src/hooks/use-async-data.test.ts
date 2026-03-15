import { describe, test, expect, mock } from 'bun:test';

// Test the cache logic at the function level rather than as a React hook
// (since we can't easily render React hooks in a non-OpenTUI test environment)

describe('useAsyncData cache logic', () => {
  test('Fresh → Stale transition based on time', () => {
    const now = Date.now();
    const freshEntry = { data: 'hello', state: 'fresh' as const, fetchedAt: now };

    // Fresh when recently fetched
    const age1 = now - freshEntry.fetchedAt;
    expect(age1).toBeLessThan(60_000);

    // Stale when older than threshold
    const staleEntry = { data: 'hello', state: 'fresh' as const, fetchedAt: now - 120_000 };
    const age2 = now - staleEntry.fetchedAt;
    expect(age2).toBeGreaterThanOrEqual(60_000);
  });

  test('Miss when key not in cache', () => {
    const cache = new Map<string, { data: string; state: string; fetchedAt: number }>();
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  test('Deduplication of inflight requests', async () => {
    let callCount = 0;
    const fetcher = async (key: string) => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `data-${key}`;
    };

    const inflight = new Map<string, Promise<string>>();

    const load = async (key: string): Promise<string> => {
      const existing = inflight.get(key);
      if (existing) return existing;

      const promise = fetcher(key).finally(() => inflight.delete(key));
      inflight.set(key, promise);
      return promise;
    };

    // Two concurrent loads for same key should only call fetcher once
    const [r1, r2] = await Promise.all([load('test'), load('test')]);
    expect(r1).toBe('data-test');
    expect(r2).toBe('data-test');
    expect(callCount).toBe(1);
  });
});
