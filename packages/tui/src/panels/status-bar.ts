import { Box, Text } from '@opentui/core';
import { COLORS } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

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

  const viewKeys = '1-8:views';
  const helpHint = '?:help';
  const base = `tab/\u2190\u2192:period  ${viewKeys}  r:refresh  ${helpHint}  q:quit`;

  let keys: string;
  if (state.selectedView === 'overview') {
    keys = `tab/\u2190\u2192:period  j/k:scroll  s:sort  ${viewKeys}  r:refresh  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'matrix') {
    keys = `tab/\u2190\u2192:period  [/]:page  ${viewKeys}  r:refresh  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'explain') {
    keys = `tab/\u2190\u2192:period  h/l:date  ${viewKeys}  r:refresh  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'advisor' || state.selectedView === 'focus' || state.selectedView === 'compare' || state.selectedView === 'wrapped') {
    keys = `tab/\u2190\u2192:period  j/k:scroll  ${viewKeys}  r:refresh  ${helpHint}  q:quit`;
  } else if (state.selectedView === 'export') {
    keys = `p:png  w:wrapped  l:live  ${viewKeys}  r:refresh  ${helpHint}  q:quit`;
  } else {
    keys = base;
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
