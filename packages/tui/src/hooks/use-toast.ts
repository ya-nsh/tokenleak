import { useState, useCallback, useRef, useEffect } from 'react';

export type Toast = {
  id: number;
  message: string;
  expiresAt: number;
};

export type UseToastResult = {
  toasts: Toast[];
  show: (message: string, durationMs?: number) => void;
  dismiss: (id: number) => void;
};

const DEFAULT_TOAST_DURATION = 3000;

export function useToast(): UseToastResult {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, durationMs = DEFAULT_TOAST_DURATION) => {
    const id = nextId.current++;
    const expiresAt = Date.now() + durationMs;
    setToasts((prev) => [...prev, { id, message, expiresAt }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;

    const now = Date.now();
    const nextExpiry = Math.min(...toasts.map((t) => t.expiresAt));
    const delay = Math.max(100, nextExpiry - now);

    const timer = setTimeout(() => {
      const cutoff = Date.now();
      setToasts((prev) => prev.filter((t) => t.expiresAt > cutoff));
    }, delay);

    return () => clearTimeout(timer);
  }, [toasts]);

  return { toasts, show, dismiss };
}
