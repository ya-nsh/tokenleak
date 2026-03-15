import { useMemo } from 'react';
import { useTerminalDimensions } from '@opentui/react';

export type LayoutMode = 'narrow' | 'balanced' | 'wide';

const NARROW_THRESHOLD = 80;
const WIDE_THRESHOLD = 120;

export function useLayoutMode(): { mode: LayoutMode; width: number; height: number } {
  const { width, height } = useTerminalDimensions();

  const mode = useMemo((): LayoutMode => {
    if (width < NARROW_THRESHOLD) return 'narrow';
    if (width > WIDE_THRESHOLD) return 'wide';
    return 'balanced';
  }, [width]);

  return { mode, width, height };
}

export function getLayoutMode(width: number): LayoutMode {
  if (width < NARROW_THRESHOLD) return 'narrow';
  if (width > WIDE_THRESHOLD) return 'wide';
  return 'balanced';
}
