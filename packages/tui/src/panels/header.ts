import { Box, Text } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { formatCostWithCompleteness } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState, ViewMode } from '../lib/state.js';
import { WINDOW_LABELS } from '../lib/state.js';
import { OVERFLOW_MARKER_WIDTH, fitTabWindow, tabWidth } from '../lib/fit.js';

const HEADER_PADDING = 2;
const RIGHT_GAP = 2;
const SECTION_GAP = 1;

function formatCompactTime(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

export type ViewSwitchCallback = (mode: ViewMode) => void;

const VIEWS: { key: string; label: string; mode: ViewMode }[] = [
  { key: '1', label: 'Overview', mode: 'overview' },
  { key: 'U', label: 'Quotas', mode: 'quotas' },
  { key: '2', label: 'Matrix', mode: 'matrix' },
  { key: '3', label: 'Advisor', mode: 'advisor' },
  { key: '4', label: 'Focus', mode: 'focus' },
  { key: '5', label: 'Explain', mode: 'explain' },
  { key: '6', label: 'Compare', mode: 'compare' },
  { key: '7', label: 'Export', mode: 'export' },
  { key: '8', label: 'Wrapped', mode: 'wrapped' },
  { key: '9', label: 'Replay', mode: 'replay' },
  { key: '0', label: 'AI ROI', mode: 'nutrition' },
  { key: 'R', label: 'Receipts', mode: 'receipts' },
  { key: 'X', label: 'Sim', mode: 'simulator' },
  { key: 'Y', label: 'Waste', mode: 'waste' },
  { key: 'Z', label: 'Diff', mode: 'behavior' },
];

export function buildHeader(
  state: AppState,
  renderer: CliRenderer,
  onViewSwitch?: ViewSwitchCallback,
) {
  const costStr = state.data
    ? formatCostWithCompleteness(
        state.data.allTimeStats.totalCost,
        state.data.allTimeStats.costCompleteness,
      )
    : '$...';

  const windowIdx = state.selectedWindowIndex;
  const stats = state.data?.windows[windowIdx]?.stats;
  const windowCost = stats
    ? formatCostWithCompleteness(stats.totalCost, stats.costCompleteness)
    : costStr;

  // Build tab indicators manually since TabSelect is a Renderable
  const tabParts: ReturnType<typeof Text | typeof Box>[] = [];
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

  // View mode indicators — each is a clickable Box. Keyboard shortcuts stay in
  // the help panel so the tab row remains clean. On narrow terminals only the
  // tabs around the active view are shown, with ‹ › marking the rest.
  const rightText = state.selectedView === 'quotas' ? 'Account capacity' : windowCost;
  const time = formatCompactTime();
  const periodWidth = state.selectedView === 'quotas'
    ? ' LIVE '.length
    : WINDOW_LABELS.reduce((sum, label) => sum + tabWidth(label), 0);
  // Without a measured terminal (tests, first frame) show every tab.
  const terminalWidth = Number.isFinite(renderer.width) ? renderer.width : Number.POSITIVE_INFINITY;
  const budget =
    terminalWidth - HEADER_PADDING - periodWidth - SECTION_GAP - rightText.length - RIGHT_GAP - time.length - RIGHT_GAP;
  const activeIndex = Math.max(0, VIEWS.findIndex((v) => v.mode === state.selectedView));
  const window = fitTabWindow(VIEWS.map((v) => v.label), activeIndex, budget);
  const viewParts: ReturnType<typeof Box | typeof Text>[] = [];
  if (window.start > 0) {
    viewParts.push(Text({ content: '‹'.padEnd(OVERFLOW_MARKER_WIDTH), fg: COLORS.dimWhite }));
  }
  for (const v of VIEWS.slice(window.start, window.end)) {
    const isActive = state.selectedView === v.mode;
    const viewMode = v.mode;
    const children = isActive
      ? [
          Text({
            content: ` ${v.label} `,
            fg: COLORS.bg,
            bg: COLORS.cyan,
            attributes: BOLD,
          }),
        ]
      : [
          Text({
            content: ` ${v.label} `,
            fg: COLORS.dimWhite,
          }),
        ];

    viewParts.push(
      Box(
        {
          flexDirection: 'row',
          onMouseDown: onViewSwitch
            ? () => {
                onViewSwitch(viewMode);
              }
            : undefined,
        },
        ...children,
      ),
    );
  }
  if (window.end < VIEWS.length) {
    viewParts.push(Text({ content: '›'.padStart(OVERFLOW_MARKER_WIDTH), fg: COLORS.dimWhite }));
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
      { flexDirection: 'row' },
      ...(state.selectedView === 'quotas' ? [Text({ content: ' LIVE ', fg: COLORS.cyan })] : tabParts),
      Text({ content: ' ', fg: COLORS.dimWhite }),
      ...viewParts,
    ),
    Box(
      { flexDirection: 'row', gap: 2 },
      Text({ content: rightText, fg: COLORS.amber, attributes: BOLD }),
      Text({ content: time, fg: COLORS.green }),
    ),
  );
}
