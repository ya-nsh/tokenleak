import { describe, expect, test } from 'bun:test';
import type { ViewMode } from './state';
import {
  VIEW_GROUPS,
  VIEW_ORDER,
  adjacentView,
  entryViewOf,
  groupOfView,
  viewForKey,
} from './views';

const ALL_VIEWS: ViewMode[] = [
  'quotas',
  'overview',
  'matrix',
  'advisor',
  'focus',
  'explain',
  'compare',
  'export',
  'wrapped',
  'replay',
  'nutrition',
  'receipts',
  'simulator',
  'waste',
  'behavior',
];

describe('VIEW_GROUPS', () => {
  test('has six groups that hold every view exactly once', () => {
    expect(VIEW_GROUPS).toHaveLength(6);
    expect([...VIEW_ORDER].sort()).toEqual([...ALL_VIEWS].sort());
    expect(new Set(VIEW_ORDER).size).toBe(VIEW_ORDER.length);
  });

  test('group keys are 1 to 6 in order', () => {
    expect(VIEW_GROUPS.map((group) => group.key)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  test('groups the views as planned', () => {
    expect(groupOfView('quotas').id).toBe('overview');
    expect(groupOfView('compare').id).toBe('spend');
    expect(groupOfView('explain').id).toBe('sessions');
    expect(groupOfView('receipts').id).toBe('savings');
    expect(groupOfView('behavior').id).toBe('roi');
    expect(groupOfView('wrapped').id).toBe('share');
  });
});

describe('viewForKey', () => {
  test('a group key opens the group’s first sub-tab', () => {
    expect(viewForKey('4', 'overview', {})).toBe('advisor');
    expect(viewForKey('2', 'advisor', {})).toBe('matrix');
  });

  test('a group key returns to the sub-tab last used in that group', () => {
    expect(viewForKey('4', 'overview', { savings: 'simulator' })).toBe('simulator');
  });

  test('pressing the active group’s key cycles its sub-tabs and wraps', () => {
    expect(viewForKey('4', 'advisor', {})).toBe('waste');
    expect(viewForKey('4', 'waste', {})).toBe('simulator');
    expect(viewForKey('4', 'receipts', {})).toBe('advisor');
  });

  test('a single-view group stays put', () => {
    const single = VIEW_GROUPS.filter((group) => group.views.length === 1);
    for (const group of single) {
      expect(viewForKey(group.key, group.views[0]!.mode, {})).toBe(group.views[0]!.mode);
    }
  });

  test('letter shortcuts jump straight to a sub-tab', () => {
    expect(viewForKey('U', 'matrix', {})).toBe('quotas');
    expect(viewForKey('R', 'overview', {})).toBe('receipts');
    expect(viewForKey('X', 'overview', {})).toBe('simulator');
    expect(viewForKey('Y', 'overview', {})).toBe('waste');
    expect(viewForKey('Z', 'overview', {})).toBe('behavior');
  });

  test('other keys and prototype names are not view keys', () => {
    for (const key of ['7', '0', 'q', 'constructor', 'toString', '']) {
      expect(viewForKey(key, 'overview', {})).toBeNull();
    }
  });
});

describe('adjacentView', () => {
  test('walks every view in order and crosses group boundaries', () => {
    expect(adjacentView('quotas', 1)).toBe('matrix');
    expect(adjacentView('matrix', -1)).toBe('quotas');
  });

  test('wraps at both ends', () => {
    expect(adjacentView(VIEW_ORDER[VIEW_ORDER.length - 1]!, 1)).toBe(VIEW_ORDER[0]);
    expect(adjacentView(VIEW_ORDER[0]!, -1)).toBe(VIEW_ORDER[VIEW_ORDER.length - 1]);
  });
});

describe('entryViewOf', () => {
  test('prefers the remembered sub-tab, else the first', () => {
    const sessions = groupOfView('focus');
    expect(entryViewOf(sessions, {})).toBe('focus');
    expect(entryViewOf(sessions, { sessions: 'explain' })).toBe('explain');
  });
});
