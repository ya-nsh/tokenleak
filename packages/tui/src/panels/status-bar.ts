import { Box, Text } from '@opentui/core';
import { COLORS } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';
import { getCursorBannerText } from './cursor-setup.js';

function formatUpdateTime(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function buildStatusBar(state: AppState) {
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

  const helpHint = '?:help';
  const nav = `\u2190\u2192:view  tab/\u21E7tab:period  1-9/R:view`;
  const cursorHint = getCursorBannerText(state) ? '  c:cursor' : '';

  let keys: string;
  if (state.selectedView === 'overview') {
    keys = `${nav}  j/k:scroll  s:sort  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'matrix') {
    keys = `${nav}  [/]:page  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'explain') {
    keys = `${nav}  h/l:date  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'replay') {
    keys = `${nav}  h/l:date  j/k:scroll  enter:expand  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'receipts') {
    keys = `${nav}  j/k:scroll  enter:expand  o:sort  f:filter  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'advisor' || state.selectedView === 'focus' || state.selectedView === 'compare' || state.selectedView === 'wrapped') {
    keys = `${nav}  j/k:scroll  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'export') {
    keys = `${nav}  p:png  w:wrapped  l:live  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  } else {
    keys = `${nav}  r:refresh${cursorHint}  ${helpHint}  q:quit`;
  }

  return Box(
    {
      flexDirection: 'row',
      width: '100%',
      justifyContent: 'space-between',
      paddingLeft: 1,
      paddingRight: 1,
      height: 1,
    },
    Text({ content: keys, fg: COLORS.dimWhite }),
    Text({
      content: `Updated ${formatUpdateTime()}`,
      fg: COLORS.dimWhite,
    }),
  );
}
