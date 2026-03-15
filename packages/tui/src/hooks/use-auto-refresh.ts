import { useState, useEffect, useCallback, useRef } from 'react';

export type UseAutoRefreshResult = {
  enabled: boolean;
  secondsUntilRefresh: number;
  toggle: () => void;
};

/**
 * Auto-refresh hook that calls `onRefresh` at a configurable interval.
 * Returns a countdown and toggle function.
 */
export function useAutoRefresh(
  onRefresh: () => void,
  intervalSeconds = 60,
): UseAutoRefreshResult {
  const [enabled, setEnabled] = useState(false);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(intervalSeconds);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const toggle = useCallback(() => {
    setEnabled((prev) => !prev);
    setSecondsUntilRefresh(intervalSeconds);
  }, [intervalSeconds]);

  useEffect(() => {
    if (!enabled) return;

    const tick = setInterval(() => {
      setSecondsUntilRefresh((prev) => {
        if (prev <= 1) {
          onRefreshRef.current();
          return intervalSeconds;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [enabled, intervalSeconds]);

  return { enabled, secondsUntilRefresh, toggle };
}
