import { Box, Text } from '@opentui/core';
import { expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createInitialState } from '../lib/state';
import { createQuotasPanel, quotaPanelHeight } from './quotas';

test('renders quota bars and setup guidance at laptop and narrow terminal sizes', async () => {
  for (const [width, height] of [
    [120, 30],
    [60, 20],
  ]) {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width, height });
    const state = createInitialState();
    state.quotaSnapshot = {
      schemaVersion: 1,
      checkedAt: '2026-09-06T12:00:00Z',
      providers: [
        {
          provider: 'codex',
          status: 'ready',
          stale: false,
          plan: 'pro',
          fetchedAt: '2026-09-06T12:00:00Z',
          retryAt: null,
          message: null,
          windows: [
            {
              id: 'session',
              label: 'Session',
              usedPercent: 20,
              remainingPercent: 80,
              resetsAt: '2099-01-01T00:00:00Z',
              unlimited: false,
            },
          ],
        },
      ],
    };
    try {
      renderer.root.add(createQuotasPanel(state, width, height));
      await renderOnce();
      const frame = captureCharFrame();
      expect(frame).toContain('SUBSCRIPTION QUOTAS');
      expect(frame).toContain('80% left');
      expect(frame).toContain('[========--]');
      expect(frame).toContain('r refresh');
    } finally {
      renderer.destroy();
    }
  }
});

test('quota rows stay distinct inside the header/banner/footer layout', async () => {
  const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
    width: 80,
    height: 16,
  });
  const state = createInitialState();
  state.quotasScrollOffset = 999;
  state.quotaSnapshot = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    providers: [
      {
        provider: 'codex',
        status: 'ready',
        plan: null,
        windows: Array.from({ length: 12 }, (_, i) => ({
          id: String(i),
          label: 'bucket ' + i,
          remainingPercent: 50,
          usedPercent: 50,
          unlimited: false,
          resetsAt: null,
        })),
        fetchedAt: null,
        stale: false,
        retryAt: null,
        message: 'LAST PROVIDER MESSAGE',
      },
    ],
  };
  try {
    renderer.root.add(
      Box(
        { flexDirection: 'column', height: '100%', width: '100%' },
        Text({ content: 'HEADER', height: 1 }),
        Text({ content: 'CURSOR BANNER', height: 1 }),
        createQuotasPanel(state, 80, quotaPanelHeight(16, true)),
        Text({ content: 'GLOBAL FOOTER', height: 1 }),
      ),
    );
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).toContain('bucket 9: [=====-----] 50% left');
    expect(frame).toContain('bucket 10: [=====-----] 50% left');
    expect(frame).toContain('bucket 11: [=====-----] 50% left');
    expect(frame).toContain('GLOBAL FOOTER');
  } finally {
    renderer.destroy();
  }
});

test('quota content height handles banners and tiny terminals', () => {
  expect(quotaPanelHeight(24, false)).toBe(22);
  expect(quotaPanelHeight(24, true)).toBe(21);
  expect(quotaPanelHeight(1, true)).toBe(0);
});
