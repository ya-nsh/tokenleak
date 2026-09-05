import { expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createInitialState } from '../lib/state';
import { createQuotasPanel } from './quotas';

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
