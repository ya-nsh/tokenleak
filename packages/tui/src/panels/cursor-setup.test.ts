import { describe, expect, test } from 'bun:test';
import { createInitialState } from '../lib/state.js';
import { getCursorBannerText } from './cursor-setup.js';

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
