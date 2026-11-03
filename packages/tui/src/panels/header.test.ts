import { describe, expect, test } from 'bun:test';
import type { CliRenderer } from '@opentui/core';
import { createInitialState } from '../lib/state.js';
import { buildHeader, buildSubTabBar } from './header.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectTextContent(node: unknown): string[] {
  if (!isRecord(node)) {
    return [];
  }

  const props = node['props'];
  const ownContent =
    isRecord(props) && typeof props['content'] === 'string' ? [props['content']] : [];
  const children = Array.isArray(node['children'])
    ? node['children'].flatMap((child) => collectTextContent(child))
    : [];

  return [...ownContent, ...children];
}

describe('buildHeader', () => {
  test('narrow terminals show the groups around the active one with overflow markers', () => {
    const state = createInitialState();
    state.isLoading = false;
    state.selectedView = 'focus';

    const text = collectTextContent(buildHeader(state, { width: 64 } as CliRenderer)).join('');

    expect(text).toContain(' Sessions ');
    expect(text).toContain('‹');
    expect(text).toContain('›');
    expect(text).not.toContain(' Overview ');
  });

  test('shows the six groups, not individual views, without shortcut prefixes', () => {
    const state = createInitialState();
    state.isLoading = false;

    const text = collectTextContent(buildHeader(state, {} as CliRenderer)).join('');

    for (const group of ['Overview', 'Spend', 'Sessions', 'Savings', 'ROI', 'Share']) {
      expect(text).toContain(` ${group} `);
    }
    expect(text).not.toContain(' Matrix ');
    expect(text).not.toContain(' Receipts ');
    expect(text).not.toMatch(/[0-9](Overview|Spend|Sessions|Savings|ROI|Share)/);
  });

  test('every group fits at 100 columns', () => {
    const state = createInitialState();
    state.isLoading = false;
    state.selectedView = 'behavior';

    const text = collectTextContent(buildHeader(state, { width: 100 } as CliRenderer)).join('');

    expect(text).not.toContain('‹');
    expect(text).not.toContain('›');
  });
});

describe('buildSubTabBar', () => {
  test('lists the active group’s sub-tabs and how to cycle them', () => {
    const state = createInitialState();
    state.selectedView = 'waste';

    const text = collectTextContent(buildSubTabBar(state, { width: 140 } as CliRenderer)).join('');

    expect(text).toContain('Advisor · Waste · Routing · Receipts');
    expect(text).toContain('(4: next)');
  });

  test('shows the last quota snapshot without fetching one', () => {
    const state = createInitialState();
    state.quotaSnapshot = {
      schemaVersion: 1,
      checkedAt: '2026-09-06T12:00:00Z',
      providers: [
        {
          provider: 'claude',
          status: 'ready',
          plan: null,
          windows: [
            {
              id: 'five',
              label: '5h',
              usedPercent: 58,
              remainingPercent: 42,
              resetsAt: null,
              unlimited: false,
            },
          ],
          fetchedAt: null,
          stale: false,
          message: null,
          retryAt: null,
        },
      ],
    };

    const text = collectTextContent(buildSubTabBar(state, { width: 140 } as CliRenderer)).join('');

    expect(text).toContain('Quota Claude 42%');
    expect(state.quotasLoading).toBe(false);
  });

  test('points at the quotas view before any snapshot exists', () => {
    const state = createInitialState();
    const text = collectTextContent(buildSubTabBar(state, { width: 100 } as CliRenderer)).join('');
    expect(text).toContain('Overview · Quotas');
    expect(text).toContain('U: quotas');
  });

  test('drops the quota widget rather than overflow a narrow terminal', () => {
    const state = createInitialState();
    state.selectedView = 'receipts';
    const text = collectTextContent(buildSubTabBar(state, { width: 50 } as CliRenderer)).join('');
    expect(text).toContain('Receipts');
    expect(text).not.toContain('U: quotas');
  });
});
