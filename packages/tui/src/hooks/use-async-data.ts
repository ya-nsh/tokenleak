import { useState, useCallback, useRef } from 'react';

export type CacheState = 'fresh' | 'stale' | 'miss';

export type AsyncDataEntry<T> = {
  data: T;
  state: CacheState;
  fetchedAt: number;
};

export type UseAsyncDataResult<K, T> = {
  get: (key: K) => AsyncDataEntry<T> | null;
  load: (key: K) => Promise<T>;
  invalidate: (key: K) => void;
  invalidateAll: () => void;
};

/**
 * Three-state cache hook (Fresh/Stale/Miss) for async data fetching.
 * Deduplicates in-flight requests for the same key.
 */
export function useAsyncData<K extends string, T>(
  fetcher: (key: K) => Promise<T>,
  staleDurationMs = 60_000,
): UseAsyncDataResult<K, T> {
  const [cache, setCache] = useState<Map<K, AsyncDataEntry<T>>>(new Map());
  const inflightRef = useRef<Map<K, Promise<T>>>(new Map());

  const get = useCallback(
    (key: K): AsyncDataEntry<T> | null => {
      const entry = cache.get(key);
      if (!entry) return null;

      const age = Date.now() - entry.fetchedAt;
      const state: CacheState = age < staleDurationMs ? 'fresh' : 'stale';
      return { ...entry, state };
    },
    [cache, staleDurationMs],
  );

  const load = useCallback(
    async (key: K): Promise<T> => {
      const existing = inflightRef.current.get(key);
      if (existing) return existing;

      const promise = fetcher(key)
        .then((data) => {
          const entry: AsyncDataEntry<T> = {
            data,
            state: 'fresh',
            fetchedAt: Date.now(),
          };
          setCache((prev) => {
            const next = new Map(prev);
            next.set(key, entry);
            return next;
          });
          return data;
        })
        .finally(() => {
          inflightRef.current.delete(key);
        });

      inflightRef.current.set(key, promise);
      return promise;
    },
    [fetcher],
  );

  const invalidate = useCallback(
    (key: K) => {
      setCache((prev) => {
        const entry = prev.get(key);
        if (!entry) return prev;
        const next = new Map(prev);
        next.set(key, { ...entry, state: 'stale', fetchedAt: 0 });
        return next;
      });
    },
    [],
  );

  const invalidateAll = useCallback(() => {
    setCache((prev) => {
      const next = new Map<K, AsyncDataEntry<T>>();
      for (const [key, entry] of prev) {
        next.set(key, { ...entry, state: 'stale', fetchedAt: 0 });
      }
      return next;
    });
  }, []);

  return { get, load, invalidate, invalidateAll };
}
