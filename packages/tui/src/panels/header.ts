import { Box, Text } from '@opentui/core';
import type { CliRenderer } from '@opentui/core';
import { formatCostWithCompleteness } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState, ViewMode } from '../lib/state.js';
import { WINDOW_LABELS } from '../lib/state.js';
import { OVERFLOW_MARKER_WIDTH, fitTabWindow, tabWidth } from '../lib/fit.js';
import { VIEW_GROUPS, entryViewOf, groupOfView } from '../lib/views.js';
import { quotaSummary } from '@tokenleak/renderers';

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

  // Group tabs — each is a clickable Box. Keyboard shortcuts stay in the
  // help panel so the tab row remains clean. On narrow terminals only the
  // tabs around the active group are shown, with ‹ › marking the rest.
  const rightText = state.selectedView === 'quotas' ? 'Account capacity' : windowCost;
  const time = formatCompactTime();
  const periodWidth =
    state.selectedView === 'quotas'
      ? ' LIVE '.length
      : WINDOW_LABELS.reduce((sum, label) => sum + tabWidth(label), 0);
  // Without a measured terminal (tests, first frame) show every tab.
  const terminalWidth = Number.isFinite(renderer.width) ? renderer.width : Number.POSITIVE_INFINITY;
  const budget =
    terminalWidth -
    HEADER_PADDING -
    periodWidth -
    SECTION_GAP -
    rightText.length -
    RIGHT_GAP -
    time.length -
    RIGHT_GAP;
  const activeGroup = groupOfView(state.selectedView);
  const activeIndex = VIEW_GROUPS.indexOf(activeGroup);
  const window = fitTabWindow(
    VIEW_GROUPS.map((group) => group.label),
    activeIndex,
    budget,
  );
  const viewParts: ReturnType<typeof Box | typeof Text>[] = [];
  if (window.start > 0) {
    viewParts.push(Text({ content: '‹'.padEnd(OVERFLOW_MARKER_WIDTH), fg: COLORS.dimWhite }));
  }
  for (const group of VIEW_GROUPS.slice(window.start, window.end)) {
    const isActive = group === activeGroup;
    viewParts.push(
      Box(
        {
          flexDirection: 'row',
          onMouseDown:
            onViewSwitch && !isActive
              ? () => {
                  onViewSwitch(entryViewOf(group, state.lastViewByGroup));
                }
              : undefined,
        },
        Text(
          isActive
            ? { content: ` ${group.label} `, fg: COLORS.bg, bg: COLORS.cyan, attributes: BOLD }
            : { content: ` ${group.label} `, fg: COLORS.dimWhite },
        ),
      ),
    );
  }
  if (window.end < VIEW_GROUPS.length) {
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
      ...(state.selectedView === 'quotas'
        ? [Text({ content: ' LIVE ', fg: COLORS.cyan })]
        : tabParts),
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

const SUB_TAB_SEPARATOR = ' · ';
const QUOTA_HINT = 'U: quotas';

/** The quota widget text: the last snapshot's tightest windows, or how to load one. */
function quotaWidgetText(state: AppState): string {
  const summary = state.quotaSnapshot ? quotaSummary(state.quotaSnapshot) : null;
  if (summary) return `Quota ${summary}`;
  return state.quotasLoading ? 'Checking quotas...' : QUOTA_HINT;
}

/**
 * The second header row: the active group's sub-tabs on the left and the
 * subscription quota widget on the right. The widget shows the last
 * snapshot; it never triggers a network check on its own.
 */
export function buildSubTabBar(
  state: AppState,
  renderer: CliRenderer,
  onViewSwitch?: ViewSwitchCallback,
) {
  const group = groupOfView(state.selectedView);
  const tabs: ReturnType<typeof Box | typeof Text>[] = [];
  group.views.forEach((view, index) => {
    if (index > 0) tabs.push(Text({ content: SUB_TAB_SEPARATOR, fg: COLORS.dimWhite }));
    const isActive = view.mode === state.selectedView;
    tabs.push(
      Box(
        {
          flexDirection: 'row',
          onMouseDown: onViewSwitch && !isActive ? () => onViewSwitch(view.mode) : undefined,
        },
        Text(
          isActive
            ? { content: view.label, fg: COLORS.cyan, attributes: BOLD }
            : { content: view.label, fg: COLORS.dimWhite },
        ),
      ),
    );
  });
  const hint = group.views.length > 1 ? `  (${group.key}: next)` : '';
  const tabsWidth =
    group.views.reduce((sum, view) => sum + view.label.length, 0) +
    SUB_TAB_SEPARATOR.length * (group.views.length - 1) +
    hint.length;
  const terminalWidth = Number.isFinite(renderer.width) ? renderer.width : Number.POSITIVE_INFINITY;
  const quotaBudget = terminalWidth - HEADER_PADDING - 1 - tabsWidth - RIGHT_GAP;
  const quota = quotaWidgetText(state);
  const quotaText =
    quota.length <= quotaBudget ? quota : quotaBudget >= QUOTA_HINT.length ? QUOTA_HINT : '';

  return Box(
    {
      flexDirection: 'row',
      width: '100%',
      justifyContent: 'space-between',
      paddingLeft: 2,
      paddingRight: 1,
      height: 1,
    },
    Box(
      { flexDirection: 'row' },
      ...tabs,
      ...(hint ? [Text({ content: hint, fg: COLORS.dimWhite })] : []),
    ),
    Text({ content: quotaText, fg: state.quotaSnapshot ? COLORS.amber : COLORS.dimWhite }),
  );
}
