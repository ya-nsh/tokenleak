import { describe, expect, test } from 'bun:test';
import { createInitialState } from '../lib/state.js';
import { createHelpPanel } from './help.js';
import { buildStatusBar } from './status-bar.js';

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

describe('buildStatusBar', () => {
  test('keeps direct view shortcuts out of the default status hint', () => {
    const state = createInitialState();
    state.isLoading = false;

    const text = collectTextContent(buildStatusBar(state)).join('');

    expect(text).toContain('?:keys');
    expect(text).toContain('c:cursor');
    expect(text).not.toContain('1-9/0/R:view');
  });

  test('surfaces background load failures outside of the export view', () => {
    const state = createInitialState();
    state.isLoading = false;
    state.loadError = 'Refresh failed: provider blew up';

    const text = collectTextContent(buildStatusBar(state)).join('');

    expect(text).toContain('Refresh failed: provider blew up');
    expect(text).toContain('r:retry');
  });

  test('always shows the [o] interactive replay CTA chip on every non-modal view', () => {
    const state = createInitialState();
    state.isLoading = false;

    const overviewText = collectTextContent(buildStatusBar(state)).join('');
    expect(overviewText).toContain('[o] interactive replay');

    state.selectedView = 'wrapped';
    const wrappedText = collectTextContent(buildStatusBar(state)).join('');
    expect(wrappedText).toContain('[o] interactive replay');

    state.selectedView = 'receipts';
    const receiptsText = collectTextContent(buildStatusBar(state)).join('');
    expect(receiptsText).toContain('[o] interactive replay');
    // Receipts sort moved off [o] — make sure the new key shows up.
    expect(receiptsText).toContain('S:sort');
    expect(receiptsText).not.toContain('o:sort');
  });

  test('CTA chip swaps to the open-status form once the live server is running', () => {
    const state = createInitialState();
    state.isLoading = false;
    state.replayLiveServerPort = 3567;

    const text = collectTextContent(buildStatusBar(state)).join('');
    expect(text).toContain('replay open :3567');
    expect(text).not.toContain('[o] interactive replay');
  });
});

describe('createHelpPanel', () => {
  test('continues documenting direct view shortcuts', () => {
    const text = collectTextContent(createHelpPanel()).join('');

    expect(text).toContain('1');
    expect(text).toContain('Overview');
    expect(text).toContain('0');
    expect(text).toContain('AI ROI');
    expect(text).toContain('R');
    expect(text).toContain('Receipts');
  });
});
