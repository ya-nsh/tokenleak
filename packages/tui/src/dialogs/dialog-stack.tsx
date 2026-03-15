import { useState, useCallback, useMemo, useRef, type ReactNode } from 'react';

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
 * Modal stack manager — push/pop dialogs.
 * Individual dialogs handle their own Escape key via onCancel props
 * to avoid double-firing with the stack's global handler.
 */
export function useDialogStack(): UseDialogStackResult {
  const [dialogs, setDialogs] = useState<DialogEntry[]>([]);
  const nextIdRef = useRef(0);

  const push = useCallback(
    (render: DialogEntry['render']) => {
      const id = nextIdRef.current++;
      setDialogs((prev) => [...prev, { id, render }]);
    },
    [],
  );

  const pop = useCallback(() => {
    setDialogs((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
  }, []);

  const clear = useCallback(() => {
    setDialogs([]);
  }, []);

  const hasDialogs = dialogs.length > 0;

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
