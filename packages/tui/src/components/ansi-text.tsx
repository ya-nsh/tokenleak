import { useState, useRef, useCallback, useMemo } from 'react';
import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import { clampScrollOffset } from '../menu/utils.js';

export type AnsiTextProps = {
  content: string;
  focused?: boolean;
  viewportHeight?: number;
  onScrollChange?: (offset: number, totalLines: number, viewportHeight: number) => void;
};

/**
 * Wraps pre-rendered ANSI strings in a scrollable text display.
 * Uses OpenTUI's <text> to render raw ANSI content, with manual
 * scroll offset management via keyboard.
 */
export function AnsiText({ content, focused = true, viewportHeight = 30, onScrollChange }: AnsiTextProps) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const onScrollChangeRef = useRef(onScrollChange);
  onScrollChangeRef.current = onScrollChange;

  const lines = useMemo(() => content.split('\n'), [content]);

  const updateScroll = useCallback(
    (newOffset: number) => {
      const clamped = clampScrollOffset(newOffset, lines.length, viewportHeight);
      setScrollOffset(clamped);
      onScrollChangeRef.current?.(clamped, lines.length, viewportHeight);
    },
    [lines.length, viewportHeight],
  );

  useKeyboard(
    (event: KeyEvent) => {
      if (!focused) return;

      switch (event.name) {
        case 'up':
          updateScroll(scrollOffset - 1);
          event.preventDefault();
          break;
        case 'down':
          updateScroll(scrollOffset + 1);
          event.preventDefault();
          break;
        case 'pageup':
          updateScroll(scrollOffset - viewportHeight);
          event.preventDefault();
          break;
        case 'pagedown':
          updateScroll(scrollOffset + viewportHeight);
          event.preventDefault();
          break;
        case 'home':
          updateScroll(0);
          event.preventDefault();
          break;
        case 'end':
          updateScroll(Number.MAX_SAFE_INTEGER);
          event.preventDefault();
          break;
      }
    },
  );

  const visibleContent = useMemo(() => {
    const visible = lines.slice(scrollOffset, scrollOffset + viewportHeight);
    return visible.join('\n');
  }, [lines, scrollOffset, viewportHeight]);

  return <text content={visibleContent} />;
}

export function getScrollInfo(
  scrollOffset: number,
  totalLines: number,
  viewportHeight: number,
): string | null {
  if (totalLines <= viewportHeight) return null;
  const effectiveOffset = clampScrollOffset(scrollOffset, totalLines, viewportHeight);
  return `Lines ${effectiveOffset + 1}-${Math.min(totalLines, effectiveOffset + viewportHeight)} of ${totalLines}`;
}
