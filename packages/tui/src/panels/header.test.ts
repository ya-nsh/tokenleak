import { describe, expect, test } from 'bun:test';
import type { CliRenderer } from '@opentui/core';
import { createInitialState } from '../lib/state.js';
import { buildHeader } from './header.js';

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
  test('renders view tabs without visible shortcut prefixes', () => {
    const state = createInitialState();
    state.isLoading = false;

    const text = collectTextContent(buildHeader(state, {} as CliRenderer)).join('');

    expect(text).toContain(' Overview ');
    expect(text).toContain(' Matrix ');
    expect(text).toContain(' Receipts ');
    expect(text).toContain(' Black Box ');

    for (const prefixedLabel of [
      '1Overview',
      '2Matrix',
      '3Advisor',
      '4Focus',
      '5Explain',
      '6Compare',
      '7Export',
      '8Wrapped',
      '9Replay',
      '0AI ROI',
      'RReceipts',
      'BBlack Box',
    ]) {
      expect(text).not.toContain(prefixedLabel);
    }
  });
});
