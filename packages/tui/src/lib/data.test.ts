import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInitialState } from './state';
import type { TuiData } from './data';
import {
  getScopedWindowData,
  getDailyForWindow,
  getTuiDataCachePath,
  readCachedTuiData,
  writeCachedTuiData,
} from './data';

const originalCachePath = process.env['TOKENLEAK_TUI_CACHE_PATH'];
let cachePath = '';
let testIndex = 0;

function makeTuiData(): TuiData {
  return {
    providers: [],
    allTimeStats: {},
    windows: [],
    dateRange: { since: '2026-04-01', until: '2026-04-26' },
    mergedDaily: [],
    cursorSetupStatus: {
      state: 'ready',
      hasCredentials: false,
      hasCache: false,
    },
  } as unknown as TuiData;
}

beforeEach(() => {
  testIndex += 1;
  cachePath = join(tmpdir(), `tokenleak-tui-cache-${process.pid}-${testIndex}.json`);
  process.env['TOKENLEAK_TUI_CACHE_PATH'] = cachePath;
});

afterEach(() => {
  rmSync(cachePath, { force: true });
  if (originalCachePath === undefined) {
    delete process.env['TOKENLEAK_TUI_CACHE_PATH'];
  } else {
    process.env['TOKENLEAK_TUI_CACHE_PATH'] = originalCachePath;
  }
});

describe('TUI data cache', () => {
  test('writes and reads cached TUI data', () => {
    const data = makeTuiData();

    writeCachedTuiData(data);

    expect(getTuiDataCachePath()).toBe(cachePath);
    expect(readCachedTuiData()).toEqual(data);
  });

  test('ignores corrupt cache files', () => {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, '{not-json', 'utf8');

    expect(readCachedTuiData()).toBeNull();
  });

  test('ignores incompatible cache versions', () => {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({ version: 999, generatedAt: new Date().toISOString(), data: makeTuiData() }),
      'utf8',
    );

    expect(readCachedTuiData()).toBeNull();
  });

  test('does not restore stale Cursor sync failure warnings from cache', () => {
    const data = makeTuiData();
    data.cursorSetupStatus = {
      state: 'sync_failed_cached',
      hasCredentials: true,
      hasCache: true,
      error: 'Cursor API returned status 502',
      reason: 'api',
    };
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), data }),
      'utf8',
    );

    expect(readCachedTuiData()?.cursorSetupStatus).toEqual({
      state: 'ready',
      hasCredentials: true,
      hasCache: true,
    });
  });

  test('does not persist transient Cursor sync failure warnings', () => {
    const data = makeTuiData();
    data.cursorSetupStatus = {
      state: 'sync_failed_cached',
      hasCredentials: true,
      hasCache: true,
      error: 'Cursor API returned status 502',
      reason: 'api',
    };

    writeCachedTuiData(data);

    const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as {
      data: TuiData;
    };
    expect(raw.data.cursorSetupStatus).toEqual({
      state: 'ready',
      hasCredentials: true,
      hasCache: true,
    });
  });
});

describe('getScopedWindowData', () => {
  test('filters and reuses selected-window providers and events', () => {
    const state = createInitialState();
    state.selectedWindowIndex = 1;
    state.data = {
      providers: [
        {
          name: 'test',
          displayName: 'Test',
          totalTokens: 300,
          totalCost: 0.03,
          daily: [
            { date: '2026-04-17', totalTokens: 100, cost: 0.01, models: [] },
            { date: '2026-04-25', totalTokens: 200, cost: 0.02, models: [] },
          ],
          events: [
            { date: '2026-04-17', timestamp: '2026-04-17T00:00:00.000Z' },
            { date: '2026-04-25', timestamp: '2026-04-25T00:00:00.000Z' },
          ],
        },
      ],
      allTimeStats: {},
      windows: [
        {
          label: '1D',
          days: 1,
          stats: {},
          dateRange: { since: '2026-04-26', until: '2026-04-26' },
          nutritionOutcomeSignals: [],
        },
        {
          label: '7D',
          days: 7,
          stats: {},
          dateRange: { since: '2026-04-20', until: '2026-04-26' },
          nutritionOutcomeSignals: [],
        },
        {
          label: '30D',
          days: 30,
          stats: {},
          dateRange: { since: '2026-03-28', until: '2026-04-26' },
          nutritionOutcomeSignals: [],
        },
        {
          label: '90D',
          days: 90,
          stats: {},
          dateRange: { since: '2026-01-27', until: '2026-04-26' },
          nutritionOutcomeSignals: [],
        },
        {
          label: 'ALL',
          days: 0,
          stats: {},
          dateRange: { since: '2020-01-01', until: '2026-04-26' },
          nutritionOutcomeSignals: [],
        },
      ],
      dateRange: { since: '2020-01-01', until: '2026-04-26' },
      mergedDaily: [],
      cursorSetupStatus: {
        state: 'ready',
        hasCredentials: false,
        hasCache: false,
      },
    } as unknown as TuiData;

    const scoped = getScopedWindowData(state);
    const repeated = getScopedWindowData(state);

    expect(repeated).toBe(scoped);
    expect(scoped?.windowRange).toEqual({ since: '2026-04-20', until: '2026-04-26' });
    expect(scoped?.events.map((event) => event.date)).toEqual(['2026-04-25']);
    expect(scoped?.scopedProviders[0]?.daily.map((day) => day.date)).toEqual(['2026-04-25']);
    expect(scoped?.scopedProviders[0]?.totalTokens).toBe(200);
    expect(scoped?.scopedProviders[0]?.totalCost).toBe(0.02);
  });
});

describe('getDailyForWindow', () => {
  test('reuses precomputed window daily data when available', () => {
    const daily = [
      {
        date: '2026-04-25',
        inputTokens: 100,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 200,
        cost: 0.02,
        models: [],
      },
    ];
    const data = {
      providers: [],
      allTimeStats: {},
      windows: [
        {
          label: '1D',
          days: 1,
          stats: {},
          dateRange: { since: '2026-04-25', until: '2026-04-25' },
          daily,
          nutritionOutcomeSignals: [],
        },
      ],
      dateRange: { since: '2020-01-01', until: '2026-04-26' },
      mergedDaily: [],
      cursorSetupStatus: {
        state: 'ready',
        hasCredentials: false,
        hasCache: false,
      },
    } as unknown as TuiData;

    expect(getDailyForWindow(data, 0)).toBe(daily);
  });
});
