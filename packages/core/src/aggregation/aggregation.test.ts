import { describe, expect, test } from 'bun:test';
import type {
  DailyUsage,
  ProviderData,
  ProviderColors,
} from '../types';
import { calculateStreaks } from './streaks';
import { rollingWindow } from './rolling-window';
import { findPeakDay } from './peaks';
import { dayOfWeekBreakdown } from './day-of-week';
import { cacheHitRate } from './cache-rate';
import { calculateAverages } from './averages';
import { topModels } from './top-models';
import { mergeProviderData } from './merge';
import { aggregate } from './aggregate';

// --- Helpers ---

function makeDay(
  date: string,
  totalTokens: number = 100,
  cost: number = 0.01,
  opts: Partial<DailyUsage> = {},
): DailyUsage {
  return {
    date,
    inputTokens: opts.inputTokens ?? 50,
    outputTokens: opts.outputTokens ?? 50,
    cacheReadTokens: opts.cacheReadTokens ?? 0,
    cacheWriteTokens: opts.cacheWriteTokens ?? 0,
    totalTokens,
    cost,
    models: opts.models ?? [
      {
        model: 'claude-3-opus',
        inputTokens: 50,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens,
        cost,
      },
    ],
  };
}

const DUMMY_COLORS: ProviderColors = {
  primary: '#000',
  secondary: '#fff',
  gradient: ['#000', '#fff'],
};

function makeProvider(
  provider: string,
  daily: DailyUsage[],
): ProviderData {
  let totalTokens = 0;
  let totalCost = 0;
  for (const d of daily) {
    totalTokens += d.totalTokens;
    totalCost += d.cost;
  }
  return {
    provider,
    displayName: provider,
    daily,
    totalTokens,
    totalCost,
    colors: DUMMY_COLORS,
  };
}

// --- Streaks ---

describe('calculateStreaks', () => {
  test('no usage returns 0', () => {
    expect(calculateStreaks([])).toEqual({ current: 0, longest: 0 });
  });

  test('single day returns 1', () => {
    expect(calculateStreaks([makeDay('2025-01-15')])).toEqual({
      current: 1,
      longest: 1,
    });
  });

  test('consecutive days', () => {
    const days = [
      makeDay('2025-01-01'),
      makeDay('2025-01-02'),
      makeDay('2025-01-03'),
    ];
    expect(calculateStreaks(days)).toEqual({ current: 3, longest: 3 });
  });

  test('gap resets streak', () => {
    const days = [
      makeDay('2025-01-01'),
      makeDay('2025-01-02'),
      makeDay('2025-01-04'), // gap
      makeDay('2025-01-05'),
    ];
    const result = calculateStreaks(days);
    expect(result.current).toBe(2);
    expect(result.longest).toBe(2);
  });

  test('current streak differs from longest', () => {
    const days = [
      makeDay('2025-01-01'),
      makeDay('2025-01-02'),
      makeDay('2025-01-03'),
      makeDay('2025-01-04'),
      // gap
      makeDay('2025-01-10'),
      makeDay('2025-01-11'),
    ];
    const result = calculateStreaks(days);
    expect(result.current).toBe(2);
    expect(result.longest).toBe(4);
  });

  test('streak spanning month boundary', () => {
    const days = [
      makeDay('2025-01-30'),
      makeDay('2025-01-31'),
      makeDay('2025-02-01'),
      makeDay('2025-02-02'),
    ];
    expect(calculateStreaks(days)).toEqual({ current: 4, longest: 4 });
  });

  test('streak spanning year boundary', () => {
    const days = [
      makeDay('2024-12-30'),
      makeDay('2024-12-31'),
      makeDay('2025-01-01'),
    ];
    expect(calculateStreaks(days)).toEqual({ current: 3, longest: 3 });
  });
});

// --- Rolling Window ---

describe('rollingWindow', () => {
  test('empty data returns zeros', () => {
    expect(rollingWindow([], 30, '2025-01-30')).toEqual({
      tokens: 0,
      cost: 0,
    });
  });

  test('includes data inside window', () => {
    const days = [
      makeDay('2025-01-28', 100, 0.01),
      makeDay('2025-01-29', 200, 0.02),
      makeDay('2025-01-30', 300, 0.03),
    ];
    const result = rollingWindow(days, 3, '2025-01-30');
    expect(result.tokens).toBe(600);
    expect(result.cost).toBeCloseTo(0.06);
  });

  test('excludes data outside window', () => {
    const days = [
      makeDay('2025-01-01', 999, 9.99), // outside 3-day window
      makeDay('2025-01-28', 100, 0.01),
      makeDay('2025-01-29', 200, 0.02),
      makeDay('2025-01-30', 300, 0.03),
    ];
    const result = rollingWindow(days, 3, '2025-01-30');
    expect(result.tokens).toBe(600);
  });

  test('30-day window', () => {
    const days = [
      makeDay('2025-01-01', 500, 0.05), // inside 30 days from Jan 30
      makeDay('2025-01-30', 100, 0.01),
    ];
    const result = rollingWindow(days, 30, '2025-01-30');
    expect(result.tokens).toBe(600);
  });
});

// --- Peaks ---

describe('findPeakDay', () => {
  test('empty returns null', () => {
    expect(findPeakDay([])).toBeNull();
  });

  test('single day', () => {
    expect(findPeakDay([makeDay('2025-01-01', 500)])).toEqual({
      date: '2025-01-01',
      tokens: 500,
    });
  });

  test('picks highest', () => {
    const days = [
      makeDay('2025-01-01', 100),
      makeDay('2025-01-02', 500),
      makeDay('2025-01-03', 200),
    ];
    expect(findPeakDay(days)).toEqual({ date: '2025-01-02', tokens: 500 });
  });

  test('ties pick most recent', () => {
    const days = [
      makeDay('2025-01-01', 500),
      makeDay('2025-01-05', 500),
      makeDay('2025-01-03', 500),
    ];
    expect(findPeakDay(days)).toEqual({ date: '2025-01-05', tokens: 500 });
  });
});

// --- Day of Week ---

describe('dayOfWeekBreakdown', () => {
  test('returns 7 entries for empty data', () => {
    const result = dayOfWeekBreakdown([]);
    expect(result).toHaveLength(7);
    expect(result[0]!.label).toBe('Sunday');
    expect(result[6]!.label).toBe('Saturday');
    for (const entry of result) {
      expect(entry.tokens).toBe(0);
      expect(entry.count).toBe(0);
    }
  });

  test('data on one day only', () => {
    // 2025-01-06 is a Monday
    const result = dayOfWeekBreakdown([makeDay('2025-01-06', 100, 0.01)]);
    expect(result[1]!.label).toBe('Monday');
    expect(result[1]!.tokens).toBe(100);
    expect(result[1]!.count).toBe(1);
    // All other days should be 0
    expect(result[0]!.count).toBe(0);
    expect(result[2]!.count).toBe(0);
  });

  test('data on all days aggregated', () => {
    // Mon through Sun in a week
    const days = [
      makeDay('2025-01-05', 10), // Sunday
      makeDay('2025-01-06', 20), // Monday
      makeDay('2025-01-07', 30), // Tuesday
      makeDay('2025-01-08', 40), // Wednesday
      makeDay('2025-01-09', 50), // Thursday
      makeDay('2025-01-10', 60), // Friday
      makeDay('2025-01-11', 70), // Saturday
    ];
    const result = dayOfWeekBreakdown(days);
    expect(result[0]!.tokens).toBe(10); // Sunday
    expect(result[6]!.tokens).toBe(70); // Saturday
    for (const entry of result) {
      expect(entry.count).toBe(1);
    }
  });
});

// --- Cache Rate ---

describe('cacheHitRate', () => {
  test('empty data returns 0', () => {
    expect(cacheHitRate([])).toBe(0);
  });

  test('0 cache tokens returns 0%', () => {
    const days = [makeDay('2025-01-01', 100, 0.01, { inputTokens: 100, cacheReadTokens: 0 })];
    expect(cacheHitRate(days)).toBe(0);
  });

  test('all cache returns 100%', () => {
    const days = [makeDay('2025-01-01', 100, 0.01, { inputTokens: 0, cacheReadTokens: 100 })];
    expect(cacheHitRate(days)).toBe(1);
  });

  test('mixed cache', () => {
    const days = [
      makeDay('2025-01-01', 100, 0.01, { inputTokens: 50, cacheReadTokens: 50 }),
    ];
    expect(cacheHitRate(days)).toBe(0.5);
  });

  test('zero denominator returns 0', () => {
    const days = [makeDay('2025-01-01', 100, 0.01, { inputTokens: 0, cacheReadTokens: 0 })];
    expect(cacheHitRate(days)).toBe(0);
  });
});

// --- Averages ---

describe('calculateAverages', () => {
  test('empty data returns zeros', () => {
    expect(calculateAverages([], 0)).toEqual({ tokens: 0, cost: 0 });
  });

  test('computes averages over totalDays', () => {
    const days = [
      makeDay('2025-01-01', 100, 0.10),
      makeDay('2025-01-02', 200, 0.20),
    ];
    const result = calculateAverages(days, 10);
    expect(result.tokens).toBe(30);
    expect(result.cost).toBeCloseTo(0.03);
  });
});

// --- Top Models ---

describe('topModels', () => {
  test('single model', () => {
    const days = [makeDay('2025-01-01', 100)];
    const result = topModels(days);
    expect(result).toHaveLength(1);
    expect(result[0]!.model).toBe('claude-3-opus');
    expect(result[0]!.percentage).toBe(1);
  });

  test('multiple models sorted by tokens', () => {
    const days = [
      makeDay('2025-01-01', 300, 0.03, {
        models: [
          { model: 'claude-3-opus', inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 200, cost: 0.02 },
          { model: 'claude-3-haiku', inputTokens: 50, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100, cost: 0.01 },
        ],
      }),
    ];
    const result = topModels(days);
    expect(result).toHaveLength(2);
    expect(result[0]!.model).toBe('claude-3-opus');
    expect(result[1]!.model).toBe('claude-3-haiku');
  });

  test('limit restricts results', () => {
    const days = [
      makeDay('2025-01-01', 600, 0.06, {
        models: [
          { model: 'model-a', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 300, cost: 0.03 },
          { model: 'model-b', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 200, cost: 0.02 },
          { model: 'model-c', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 100, cost: 0.01 },
        ],
      }),
    ];
    const result = topModels(days, 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.model).toBe('model-a');
    expect(result[1]!.model).toBe('model-b');
  });
});

// --- Merge ---

describe('mergeProviderData', () => {
  test('empty providers returns empty', () => {
    expect(mergeProviderData([])).toEqual([]);
  });

  test('single provider passes through', () => {
    const p = makeProvider('cursor', [makeDay('2025-01-01', 100)]);
    const result = mergeProviderData([p]);
    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe('2025-01-01');
  });

  test('multiple providers same date merges tokens', () => {
    const p1 = makeProvider('cursor', [makeDay('2025-01-01', 100, 0.01)]);
    const p2 = makeProvider('windsurf', [makeDay('2025-01-01', 200, 0.02)]);
    const result = mergeProviderData([p1, p2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.totalTokens).toBe(300);
    expect(result[0]!.cost).toBeCloseTo(0.03);
    expect(result[0]!.models).toHaveLength(2);
  });

  test('multiple providers different dates', () => {
    const p1 = makeProvider('cursor', [makeDay('2025-01-01', 100)]);
    const p2 = makeProvider('windsurf', [makeDay('2025-01-02', 200)]);
    const result = mergeProviderData([p1, p2]);
    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe('2025-01-01');
    expect(result[1]!.date).toBe('2025-01-02');
  });

  test('result is sorted by date', () => {
    const p1 = makeProvider('a', [makeDay('2025-01-05')]);
    const p2 = makeProvider('b', [makeDay('2025-01-01')]);
    const result = mergeProviderData([p1, p2]);
    expect(result[0]!.date).toBe('2025-01-01');
    expect(result[1]!.date).toBe('2025-01-05');
  });
});

// --- Aggregate Orchestrator ---

describe('aggregate', () => {
  test('empty data returns zeroed stats', () => {
    const result = aggregate([], '2025-01-30');
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.totalCost).toBe(0);
    expect(result.totalDays).toBe(0);
    expect(result.activeDays).toBe(0);
    expect(result.peakDay).toBeNull();
    expect(result.cacheHitRate).toBe(0);
    expect(result.dayOfWeek).toHaveLength(7);
    expect(result.topModels).toHaveLength(0);
  });

  test('produces valid AggregatedStats from daily data', () => {
    const days = [
      makeDay('2025-01-28', 100, 0.01),
      makeDay('2025-01-29', 200, 0.02),
      makeDay('2025-01-30', 300, 0.03),
    ];
    const result = aggregate(days, '2025-01-30');
    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
    expect(result.totalTokens).toBe(600);
    expect(result.totalCost).toBeCloseTo(0.06);
    expect(result.activeDays).toBe(3);
    expect(result.totalDays).toBe(3);
    expect(result.peakDay).toEqual({ date: '2025-01-30', tokens: 300 });
    expect(result.rolling7dTokens).toBe(600);
    expect(result.rolling30dTokens).toBe(600);
    expect(result.dayOfWeek).toHaveLength(7);
    expect(result.topModels.length).toBeGreaterThan(0);
    expect(result.averageDailyTokens).toBe(200);
    expect(result.averageDailyCost).toBeCloseTo(0.02);
  });
});
