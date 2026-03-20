import { describe, expect, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { createInitialState } from '../lib/state.js';
import {
  CURSOR_SESSION_COOKIE_NAME,
  createCursorSetupPanel,
  getCursorBannerText,
  getCursorSetupInstructions,
} from './cursor-setup.js';

describe('getCursorBannerText', () => {
  test('returns null when Cursor setup is ready', () => {
    const state = createInitialState();
    state.data = {
      providers: [],
      allTimeStats: {
        currentStreak: 0,
        longestStreak: 0,
        rolling30dTokens: 0,
        rolling30dCost: 0,
        rolling7dTokens: 0,
        rolling7dCost: 0,
        totalTokens: 0,
        totalCost: 0,
        activeDays: 0,
        averageDailyTokens: 0,
        averageDailyCost: 0,
        peakDay: null,
        cacheHitRate: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalDays: 0,
        dayOfWeek: [],
        topModels: [],
        rolling30dTopModel: null,
      },
      windows: [],
      dateRange: { since: '2026-01-01', until: '2026-03-20' },
      mergedDaily: [],
      cursorSetupStatus: {
        state: 'ready',
        hasCredentials: false,
        hasCache: false,
      },
    };

    expect(getCursorBannerText(state)).toBeNull();
  });

  test('returns a connect prompt when Cursor is not authenticated', () => {
    const state = createInitialState();
    state.cursorSetupStatusOverride = {
      state: 'needs_auth',
      hasCredentials: false,
      hasCache: false,
    };

    expect(getCursorBannerText(state)).toBe('Cursor not connected. Press c to connect.');
  });

  test('returns a cached-sync warning when refresh fails', () => {
    const state = createInitialState();
    state.cursorSetupStatusOverride = {
      state: 'sync_failed_cached',
      hasCredentials: true,
      hasCache: true,
      error: 'Cursor API returned status 502',
      reason: 'api',
    };

    expect(getCursorBannerText(state)).toBe('Cursor sync failed, using cached data. Press c for details.');
  });
});

describe('createCursorSetupPanel', () => {
  test('instructions point users to the Cursor session cookie path', () => {
    const lines = getCursorSetupInstructions(null);

    expect(lines.some((line) => line.includes('Application (or Storage) > Cookies > https://www.cursor.com'))).toBe(true);
    expect(lines.some((line) => line.includes(CURSOR_SESSION_COOKIE_NAME))).toBe(true);
  });

  test('focused field updates state and token input accepts bracketed paste', async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({
      width: 140,
      height: 30,
      useMouse: true,
    });
    const state = createInitialState();
    let submitCount = 0;

    try {
      const { panel, labelInput, tokenInput } = createCursorSetupPanel(state, renderer, {
        onFieldFocus: (field) => {
          state.cursorSetupField = field;
        },
        onLabelInput: (value) => {
          state.cursorSetupLabel = value;
        },
        onTokenInput: (value) => {
          state.cursorSetupToken = value;
        },
        onSubmit: () => {
          submitCount += 1;
        },
      });

      renderer.root.add(panel);
      labelInput.focus();
      await renderOnce();
      expect(state.cursorSetupField).toBe('label');

      tokenInput.focus();
      await renderOnce();
      expect(state.cursorSetupField).toBe('token');

      await mockInput.pasteBracketedText('cookie-line-1\ncookie-line-2');
      await renderOnce();

      expect(state.cursorSetupToken).toBe('cookie-line-1cookie-line-2');
      expect(tokenInput.value).toBe('cookie-line-1cookie-line-2');
      expect(submitCount).toBe(0);
    } finally {
      renderer.destroy();
    }
  });

  test('pressing Enter in the token input submits the setup flow', async () => {
    const { renderer, mockInput, renderOnce } = await createTestRenderer({
      width: 140,
      height: 30,
      useMouse: true,
    });
    const state = createInitialState();
    let submitCount = 0;

    try {
      const { panel, tokenInput } = createCursorSetupPanel(state, renderer, {
        onFieldFocus: (field) => {
          state.cursorSetupField = field;
        },
        onLabelInput: (value) => {
          state.cursorSetupLabel = value;
        },
        onTokenInput: (value) => {
          state.cursorSetupToken = value;
        },
        onSubmit: () => {
          submitCount += 1;
        },
      });

      renderer.root.add(panel);
      tokenInput.focus();
      await renderOnce();

      await mockInput.typeText('session-cookie-value');
      await renderOnce();
      mockInput.pressEnter();
      await renderOnce();

      expect(state.cursorSetupToken).toBe('session-cookie-value');
      expect(submitCount).toBe(1);
    } finally {
      renderer.destroy();
    }
  });
});
