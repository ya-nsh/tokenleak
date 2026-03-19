import { Box, Text } from '@opentui/core';
import { COLORS, BOLD } from '../lib/theme.js';
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

  const keys = state.selectedView === 'overview'
    ? 'tab/\u2190\u2192:period  j/k:scroll  s:sort  1:overview  2:bloomberg  r:refresh  q:quit'
    : 'tab/\u2190\u2192:period  1:overview  2:bloomberg  r:refresh  q:quit';

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
