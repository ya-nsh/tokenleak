import { useCallback } from 'react';
import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';

export type KeyBinding = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  action: () => void;
};

/**
 * Wraps OpenTUI's useKeyboard with a declarative keybinding map.
 * Matches on key.name (lowercase) and optional modifiers.
 */
export function useKeymap(bindings: KeyBinding[]): void {
  const handler = useCallback(
    (event: KeyEvent) => {
      for (const binding of bindings) {
        if (event.name !== binding.key) continue;
        if (binding.ctrl && !event.ctrl) continue;
        if (binding.shift && !event.shift) continue;
        binding.action();
        event.preventDefault();
        return;
      }
    },
    [bindings],
  );

  useKeyboard(handler);
}
