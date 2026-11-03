import { Box, Text } from '@opentui/core';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';
import { fitHints, type Hint } from '../lib/fit.js';

const DEFAULT_STATUS_WIDTH = 120;
const STATUS_PADDING = 2;
const UPDATED_WIDTH = 'Updated 00:00'.length + 2;
const REPLAY_CHIP = ' ▶ [o] interactive replay  · ';

/** The replay chip belongs to the views it acts on, or when a server is running. */
function showsReplayChip(state: AppState): boolean {
  return state.replayLiveServerPort !== null || state.selectedView === 'replay';
}

function chipWidth(state: AppState): number {
  if (!showsReplayChip(state)) return 0;
  return state.replayLiveServerPort !== null
    ? ` ✓ replay open :${state.replayLiveServerPort}  · `.length
    : REPLAY_CHIP.length;
}

/** Hints for the active view; priority 0 survives longest. */
function viewHints(state: AppState): Hint[] {
  const viewSpecific: Record<string, string[]> = {
    overview: ['j/k:scroll', 's:sort'],
    matrix: ['[/]:page'],
    explain: ['h/l:date'],
    replay: ['h/l:date', 'j/k:select', 'enter/space:toggle'],
    receipts: ['j/k:select', 'enter/space:toggle', 'S:sort', 'f:filter'],
    export: ['p:png', 'w:wrapped', 'l:live', 'a:LLM prompt'],
    advisor: ['j/k:scroll'],
    focus: ['j/k:scroll'],
    compare: ['j/k:scroll'],
    wrapped: ['j/k:scroll'],
    nutrition: ['j/k:scroll'],
    simulator: ['j/k:scroll'],
    waste: ['j/k:scroll'],
    behavior: ['j/k:scroll'],
  };
  return [
    { text: '/:go to', priority: 1 },
    { text: '1-6:group', priority: 1 },
    { text: '←→:tab', priority: 2 },
    // The selected period is always visible in the header, so its hint goes early.
    { text: 'tab/⇧tab:period', priority: 5 },
    ...(viewSpecific[state.selectedView] ?? []).map((text, index) => ({ text, priority: 2 + index })),
    { text: 'r:refresh', priority: 4 },
    { text: 'c:cursor', priority: 6 },
    { text: '?:keys', priority: 1 },
    { text: 'q:quit', priority: 0 },
  ];
}

function formatUpdateTime(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Build the bright-emerald global CTA chip. Always shown in the footer
 * (any view) so the interactive browser replay is one keystroke away
 * from anywhere in the TUI. When the server is already running, swap
 * the text to a status indicator instead.
 */
export function buildReplayCtaChip(state: AppState) {
  if (state.replayLiveServerPort !== null) {
    return Text({
      content: ` ✓ replay open :${state.replayLiveServerPort}  · `,
      fg: COLORS.green,
      attributes: BOLD,
    });
  }
  return Text({
    content: REPLAY_CHIP,
    fg: COLORS.green,
    attributes: BOLD,
  });
}

export function buildStatusBar(state: AppState, width = DEFAULT_STATUS_WIDTH) {
  if (state.selectedView === 'quotas' && !state.showHelp && !state.showCursorSetup) {
    return Box({ flexDirection: 'row', width: '100%', height: 1, paddingLeft: 1 },
      Text({ content: `${state.quotasLoading ? 'Checking quotas...  ' : ''}←→:view  j/k:scroll  r:refresh  ?:keys  q:quit`, fg: COLORS.cyan }));
  }
  if (state.isLoading) {
    return Box(
      {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'space-between',
        paddingLeft: 1,
        paddingRight: 1,
        height: 1,
      },
      Text({ content: 'Loading...', fg: COLORS.amber }),
      Text({ content: '', fg: COLORS.dimWhite }),
    );
  }

  if (state.loadError) {
    return Box(
      {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'space-between',
        paddingLeft: 1,
        paddingRight: 1,
        height: 1,
      },
      Text({ content: state.loadError, fg: COLORS.red }),
      Text({ content: 'r:retry  q:quit', fg: COLORS.dimWhite }),
    );
  }

  if (state.viewTasks.activeLabel) {
    return Box(
      {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'space-between',
        paddingLeft: 1,
        paddingRight: 1,
        height: 1,
      },
      Text({ content: `Loading ${state.viewTasks.activeLabel}...`, fg: COLORS.amber }),
      Text({ content: `Updated ${formatUpdateTime()}`, fg: COLORS.dimWhite }),
    );
  }

  if (state.showHelp) {
    return Box(
      {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'space-between',
        paddingLeft: 1,
        paddingRight: 1,
        height: 1,
      },
      Text({ content: '?/Esc:close help  q:quit', fg: COLORS.dimWhite }),
      Text({ content: `Updated ${formatUpdateTime()}`, fg: COLORS.dimWhite }),
    );
  }

  if (state.showCursorSetup) {
    return Box(
      {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'space-between',
        paddingLeft: 1,
        paddingRight: 1,
        height: 1,
      },
      Text({ content: 'tab:field  enter:token submit  esc:close', fg: COLORS.dimWhite }),
      Text({ content: `Updated ${formatUpdateTime()}`, fg: COLORS.dimWhite }),
    );
  }

  const keys = fitHints(viewHints(state), width - STATUS_PADDING - UPDATED_WIDTH - chipWidth(state));

  // View-specific keymap on the left (with the replay chip where it applies),
  // timestamp on the right. Hints shrink by priority instead of being cut.
  return Box(
    {
      flexDirection: 'row',
      width: '100%',
      justifyContent: 'space-between',
      paddingLeft: 1,
      paddingRight: 1,
      height: 1,
    },
    Box(
      { flexDirection: 'row' },
      ...(showsReplayChip(state) ? [buildReplayCtaChip(state)] : []),
      Text({ content: keys, fg: COLORS.dimWhite }),
    ),
    Text({
      content: `Updated ${formatUpdateTime()}`,
      fg: COLORS.dimWhite,
    }),
  );
}
