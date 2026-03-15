import { useState, useCallback, useMemo } from 'react';
import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import type { SelectOption } from '@opentui/core';
import type { InteractiveContext } from '../menu/types.js';
import {
  getMenuOptionsMeta,
  INTERACTIVE_FLAG_LINES,
  buildDashboardCommand,
  buildImageCommand,
  buildWrappedCommand,
  buildWrappedLiveCommand,
  buildCompareCommand,
  buildAdvisorCommand,
  buildLiveCommand,
  buildExplainCommand,
  buildFocusCommand,
  buildCustomRunCommand,
  buildJsonCommand,
} from '../menu/options.js';
import type { InteractiveCommand } from '../menu/types.js';
import { THEME } from '../theme.js';
import { useLayoutMode } from '../hooks/use-layout-mode.js';

export type LauncherProps = {
  context: InteractiveContext;
  onCommand: (command: InteractiveCommand) => void;
  onShowHelp: () => void;
};

/**
 * Build a default command for each menu option index.
 * Uses sensible defaults so the launcher is immediately functional
 * without a multi-step dialog wizard.
 */
function buildDefaultCommandForIndex(index: number): InteractiveCommand {
  switch (index) {
    case 0: // Launch Dashboard
      return buildDashboardCommand({ days: 90 }, [], null, false, false);
    case 1: // Export (PNG default)
      return buildImageCommand('png', 'dark', { days: 90 }, [], null, 'tokenleak.png', true, true);
    case 2: // AI Wrapped
      return buildWrappedCommand('dark', { days: 365 }, [], 'tokenleak-wrapped.png', true);
    case 3: // Wrapped Live
      return buildWrappedLiveCommand({ days: 365 }, []);
    case 4: // Compare Periods
      return buildCompareCommand({ days: 90 }, [], 'auto', null);
    case 5: // Advisor
      return buildAdvisorCommand('terminal', { days: 90 }, [], null, false);
    case 6: // Start Live Server
      return buildLiveCommand('dark', { days: 90 }, [], true);
    case 7: // Explain Day
      return buildExplainCommand(new Date().toISOString().slice(0, 10), 'terminal', [], null, null, false);
    case 8: // Focus Sessions
      return buildFocusCommand('terminal', { days: 30 }, [], null, null, false);
    case 9: // Build Custom Command
      return buildCustomRunCommand({ format: 'terminal', days: 90 });
    default:
      return { type: 'exit' };
  }
}

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

  const dispatchSelected = useCallback(
    (index: number) => {
      const command = buildDefaultCommandForIndex(index);
      onCommand(command);
    },
    [onCommand],
  );

  const handleSelect = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      dispatchSelected(index);
    },
    [dispatchSelected],
  );

  const handleMenuChange = useCallback(
    (index: number) => {
      setSelectedIndex(index);
    },
    [],
  );

  useKeyboard((event: KeyEvent) => {
    // Digit shortcuts
    const digit = event.sequence?.match?.(/^[0-9]$/)?.[0];
    if (digit) {
      const idx = menuMeta.findIndex((m) => m.shortcut === digit);
      if (idx >= 0) {
        setSelectedIndex(idx);
        dispatchSelected(idx);
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
          focused={true}
          wrapSelection={true}
          selectedBackgroundColor={THEME.ACTIVE}
          selectedTextColor={THEME.BOLD_FG}
          textColor={THEME.FG}
          descriptionColor={THEME.DIM}
          showDescription={true}
          onChange={handleMenuChange}
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
