import { useState, useCallback, useMemo } from 'react';
import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import type { SelectOption } from '@opentui/core';
import type { InteractiveCommand, InteractiveContext } from '../menu/types.js';
import { getMenuOptionsMeta, INTERACTIVE_FLAG_LINES } from '../menu/options.js';
import { THEME } from '../theme.js';
import { useLayoutMode } from '../hooks/use-layout-mode.js';

export type LauncherProps = {
  context: InteractiveContext;
  onCommand: (command: InteractiveCommand) => void;
  onShowHelp: () => void;
};

export function Launcher({ context, onCommand, onShowHelp }: LauncherProps) {
  const menuMeta = useMemo(() => getMenuOptionsMeta(), []);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { mode } = useLayoutMode();

  const options: SelectOption[] = useMemo(
    () =>
      menuMeta.map((m) => ({
        name: `[${m.shortcut}] ${m.title}`,
        description: m.description,
      })),
    [menuMeta],
  );

  const handleSelect = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      // Dispatch a placeholder command — the actual select flow will be handled
      // by the App component which manages the full dialog wizard state
      onCommand({ type: 'show-help' }); // temporary, overridden below
    },
    [onCommand],
  );

  // We need to notify parent which menu index was selected
  const handleMenuSelect = useCallback(
    (index: number) => {
      setSelectedIndex(index);
    },
    [],
  );

  useKeyboard((event: KeyEvent) => {
    // Digit shortcuts
    const digit = event.name?.match?.(/^[0-9]$/)?.[0] ?? event.sequence?.match?.(/^[0-9]$/)?.[0];
    if (digit) {
      const idx = menuMeta.findIndex((m) => m.shortcut === digit);
      if (idx >= 0) {
        setSelectedIndex(idx);
        onCommand({ type: 'run', request: { args: {}, preview: menuMeta[idx]!.preview, title: menuMeta[idx]!.title, loadingTitle: '', loadingDetail: '', executionMode: 'capture' } });
        event.preventDefault();
      }
      return;
    }

    if (event.name === 'h') {
      onShowHelp();
      event.preventDefault();
      return;
    }

    if (event.name === 'q' || event.name === 'escape') {
      onCommand({ type: 'exit' });
      event.preventDefault();
      return;
    }

    if (event.ctrl && event.name === 'c') {
      onCommand({ type: 'exit' });
      event.preventDefault();
      return;
    }
  });

  const selected = menuMeta[selectedIndex];

  return (
    <box flexDirection={mode === 'wide' ? 'row' : 'column'} width="100%" height="100%" gap={2}>
      {/* Left panel: menu */}
      <box flexDirection="column" flexGrow={1}>
        <text content="Tokenleak Interactive Launcher" fg={THEME.BOLD_FG} />
        <text content={`v${context.version}  interactive command center`} fg={THEME.CYAN} />
        <box height={1} />
        <text content="Arrow keys move. Shortcut keys jump directly. Enter runs the selected action." fg={THEME.DIM} />
        <box height={1} />
        <select
          options={options}
          selectedIndex={selectedIndex}
          focused={true}
          wrapSelection={true}
          selectedBackgroundColor={THEME.ACTIVE}
          selectedTextColor={THEME.BOLD_FG}
          textColor={THEME.FG}
          descriptionColor={THEME.DIM}
          showDescription={true}
          onChange={handleMenuSelect}
          onSelect={handleSelect}
        />
        <box height={1} />
        <text content="Preview" fg={THEME.BOLD_FG} />
        <text content={selected?.preview ?? ''} fg={THEME.SUCCESS} />
        <box height={1} />
        <text content="Keys" fg={THEME.BOLD_FG} />
        <text content="Up/Down move  Enter run  H help  Q quit" fg={THEME.HINT} />
      </box>

      {/* Right panel: flags (only in wide mode) */}
      {mode === 'wide' && (
        <box flexDirection="column" width={44}>
          <text content="All Flags" fg={THEME.BOLD_FG} />
          <text content="Every flag remains available while using the launcher." fg={THEME.DIM} />
          <box height={1} />
          {INTERACTIVE_FLAG_LINES.map((line, i) => (
            <text key={i} content={line} fg={THEME.CYAN} />
          ))}
        </box>
      )}
    </box>
  );
}
