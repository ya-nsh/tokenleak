import { Box, Text } from '@opentui/core';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

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
    content: ' ▶ [o] interactive replay  · ',
    fg: COLORS.green,
    attributes: BOLD,
  });
}

export function buildStatusBar(state: AppState) {
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

  const helpHint = '?:keys';
  const nav = `←→:view  tab/⇧tab:period`;
  const cursorHint = '  c:cursor';

  let keys: string;
  if (state.selectedView === 'overview') {
    keys = `${nav}  j/k:scroll  s:sort  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'matrix') {
    keys = `${nav}  [/]:page  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'explain') {
    keys = `${nav}  h/l:date  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'replay') {
    keys = `${nav}  h/l:date  j/k:select  enter/space:toggle  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'receipts') {
    keys = `${nav}  j/k:select  enter/space:toggle  S:sort  f:filter  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (
    state.selectedView === 'advisor' ||
    state.selectedView === 'focus' ||
    state.selectedView === 'compare' ||
    state.selectedView === 'wrapped' ||
    state.selectedView === 'nutrition'
    || state.selectedView === 'simulator'
    || state.selectedView === 'waste'
    || state.selectedView === 'behavior'
  ) {
    keys = `${nav}  j/k:scroll  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'export') {
    keys = `${nav}  p:png  w:wrapped  l:live  a:LLM prompt  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else {
    keys = `${nav}  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  }

  // Always-visible CTA on the left, view-specific keymap immediately
  // after, timestamp on the right. The bright emerald chip next to
  // dim-white hints is the "highlighted at any cost" affordance.
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
      buildReplayCtaChip(state),
      Text({ content: keys, fg: COLORS.dimWhite }),
    ),
    Text({
      content: `Updated ${formatUpdateTime()}`,
      fg: COLORS.dimWhite,
    }),
  );
}
