import type { ViewMode } from './state.js';

export type ViewGroupId = 'overview' | 'spend' | 'sessions' | 'savings' | 'roi' | 'share';

export interface ViewTab {
  mode: ViewMode;
  label: string;
}

export interface ViewGroup {
  id: ViewGroupId;
  /** Selects the group; pressed again inside the group, it cycles the sub-tabs. */
  key: string;
  label: string;
  /** Sub-tabs in display order; the first opens when the group is entered fresh. */
  views: readonly ViewTab[];
}

/** The top-level tabs. Every view is a sub-tab of exactly one group. */
export const VIEW_GROUPS: readonly ViewGroup[] = [
  {
    id: 'overview',
    key: '1',
    label: 'Overview',
    views: [
      { mode: 'overview', label: 'Overview' },
      { mode: 'quotas', label: 'Quotas' },
    ],
  },
  {
    id: 'spend',
    key: '2',
    label: 'Spend',
    views: [
      { mode: 'matrix', label: 'Matrix' },
      { mode: 'compare', label: 'Compare' },
    ],
  },
  {
    id: 'sessions',
    key: '3',
    label: 'Sessions',
    views: [
      { mode: 'focus', label: 'Focus' },
      { mode: 'replay', label: 'Replay' },
      { mode: 'explain', label: 'Explain' },
    ],
  },
  {
    id: 'savings',
    key: '4',
    label: 'Savings',
    views: [
      { mode: 'advisor', label: 'Advisor' },
      { mode: 'waste', label: 'Waste' },
      { mode: 'simulator', label: 'Routing' },
      { mode: 'receipts', label: 'Receipts' },
    ],
  },
  {
    id: 'roi',
    key: '5',
    label: 'ROI',
    views: [
      { mode: 'nutrition', label: 'AI ROI' },
      { mode: 'behavior', label: 'Diff' },
    ],
  },
  {
    id: 'share',
    key: '6',
    label: 'Share',
    views: [
      { mode: 'export', label: 'Export' },
      { mode: 'wrapped', label: 'Wrapped' },
    ],
  },
];

/** Letter shortcuts straight to one sub-tab, kept from the flat tab bar. */
export const DIRECT_VIEW_KEYS: Readonly<Record<string, ViewMode>> = {
  U: 'quotas',
  R: 'receipts',
  X: 'simulator',
  Y: 'waste',
  Z: 'behavior',
};

/** Every view in tab order; ← and → walk it, crossing into the next group. */
export const VIEW_ORDER: readonly ViewMode[] = VIEW_GROUPS.flatMap((group) =>
  group.views.map((view) => view.mode),
);

const GROUP_BY_VIEW = new Map<ViewMode, ViewGroup>(
  VIEW_GROUPS.flatMap((group) => group.views.map((view) => [view.mode, group] as const)),
);

export function groupOfView(mode: ViewMode): ViewGroup {
  const group = GROUP_BY_VIEW.get(mode);
  if (!group) throw new Error(`View "${mode}" is not in any group`);
  return group;
}

/** The view a group opens on: the sub-tab last used in it, else its first. */
export function entryViewOf(
  group: ViewGroup,
  lastViewByGroup: Partial<Record<ViewGroupId, ViewMode>>,
): ViewMode {
  return lastViewByGroup[group.id] ?? group.views[0]!.mode;
}

/**
 * The view a key press switches to, or null when the key is not a view key.
 * A group key enters that group, or cycles its sub-tabs when already inside it.
 */
export function viewForKey(
  key: string,
  current: ViewMode,
  lastViewByGroup: Partial<Record<ViewGroupId, ViewMode>>,
): ViewMode | null {
  const direct = Object.hasOwn(DIRECT_VIEW_KEYS, key) ? DIRECT_VIEW_KEYS[key] : undefined;
  if (direct) return direct;
  const group = VIEW_GROUPS.find((candidate) => candidate.key === key);
  if (!group) return null;
  if (groupOfView(current) !== group) return entryViewOf(group, lastViewByGroup);
  const index = group.views.findIndex((view) => view.mode === current);
  return group.views[(index + 1) % group.views.length]!.mode;
}

/** The view `step` places away in {@link VIEW_ORDER}, wrapping at both ends. */
export function adjacentView(current: ViewMode, step: number): ViewMode {
  const index = VIEW_ORDER.indexOf(current);
  const length = VIEW_ORDER.length;
  return VIEW_ORDER[(((index + step) % length) + length) % length]!;
}
