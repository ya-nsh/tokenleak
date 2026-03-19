import { Box, Text } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { formatCost } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState, ViewMode } from '../lib/state.js';
import { WINDOW_LABELS } from '../lib/state.js';

function formatCompactTime(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

export function buildHeader(state: AppState, renderer: CliRenderer) {
  const costStr = state.data
    ? formatCost(state.data.allTimeStats.totalCost)
    : '$...';

  const windowIdx = state.selectedWindowIndex;
  const stats = state.data?.windows[windowIdx]?.stats;
  const windowCost = stats ? formatCost(stats.totalCost) : costStr;

  // Build tab indicators manually since TabSelect is a Renderable
  const tabParts: ReturnType<typeof Text>[] = [];
  for (let i = 0; i < WINDOW_LABELS.length; i++) {
    const label = WINDOW_LABELS[i];
    const isSelected = i === windowIdx;
    if (isSelected) {
      tabParts.push(
        Text({
          content: ` ${label} `,
          fg: COLORS.bg,
          bg: COLORS.amber,
          attributes: BOLD,
        }),
      );
    } else {
      tabParts.push(
        Text({
          content: ` ${label} `,
          fg: state.isLoading ? COLORS.dimWhite : COLORS.white,
        }),
      );
    }
  }

  // View mode indicators
  const viewParts: ReturnType<typeof Text>[] = [];
  const views: { key: string; label: string; mode: ViewMode }[] = [
    { key: '1', label: 'Overview', mode: 'overview' },
    { key: '2', label: 'Bloomberg', mode: 'bloomberg' },
    { key: '3', label: 'Advisor', mode: 'advisor' },
    { key: '4', label: 'Focus', mode: 'focus' },
    { key: '5', label: 'Explain', mode: 'explain' },
    { key: '6', label: 'Compare', mode: 'compare' },
  ];
  for (const v of views) {
    const isActive = state.selectedView === v.mode;
    if (isActive) {
      viewParts.push(
        Text({
          content: ` ${v.label} `,
          fg: COLORS.bg,
          bg: COLORS.cyan,
          attributes: BOLD,
        }),
      );
    } else {
      viewParts.push(
        Text({
          content: ` ${v.label} `,
          fg: COLORS.dimWhite,
        }),
      );
    }
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
    Box(
      { flexDirection: 'row', gap: 1 },
      Text({ content: ' TOKENLEAK ', fg: COLORS.amber, attributes: BOLD }),
      ...tabParts,
      Text({ content: '  ', fg: COLORS.dimWhite }),
      ...viewParts,
    ),
    Box(
      { flexDirection: 'row', gap: 2 },
      Text({ content: windowCost, fg: COLORS.amber, attributes: BOLD }),
      Text({ content: formatCompactTime(), fg: COLORS.green }),
    ),
  );
}
