import { useState, useCallback, useMemo, type ReactNode } from 'react';
import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';

export type DialogEntry = {
  id: number;
  render: (dismiss: () => void) => ReactNode;
};

export type UseDialogStackResult = {
  dialogs: DialogEntry[];
  push: (render: DialogEntry['render']) => void;
  pop: () => void;
  clear: () => void;
  hasDialogs: boolean;
  topDialog: ReactNode | null;
};

/**
 * Modal stack manager — push/pop dialogs with Esc to dismiss top.
 */
export function useDialogStack(): UseDialogStackResult {
  const [dialogs, setDialogs] = useState<DialogEntry[]>([]);
  const [nextId, setNextId] = useState(0);

  const push = useCallback(
    (render: DialogEntry['render']) => {
      setDialogs((prev) => [...prev, { id: nextId, render }]);
      setNextId((prev) => prev + 1);
    },
    [nextId],
  );

  const pop = useCallback(() => {
    setDialogs((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, []);

  const clear = useCallback(() => {
    setDialogs([]);
  }, []);

  const hasDialogs = dialogs.length > 0;

  useKeyboard((event: KeyEvent) => {
    if (hasDialogs && event.name === 'escape') {
      pop();
      event.preventDefault();
    }
  });

  const topDialog = useMemo(() => {
    if (dialogs.length === 0) return null;
    const top = dialogs[dialogs.length - 1]!;
    return top.render(pop);
  }, [dialogs, pop]);

  return { dialogs, push, pop, clear, hasDialogs, topDialog };
}

export function DialogOverlay({ children }: { children: ReactNode }) {
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor="#000000cc"
    >
      <box flexDirection="column" padding={1}>
        {children}
      </box>
    </box>
  );
}
