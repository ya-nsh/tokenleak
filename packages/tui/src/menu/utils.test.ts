import { describe, test, expect } from 'bun:test';
import {
  shouldStartInteractiveCli,
  clampScrollOffset,
  stripAnsi,
  visibleLength,
  buildTabbedDashboardOptions,
  finalizeCliArgs,
  buildCliArgTokens,
  buildCliPreview,
  describeRequest,
  computeDateRange,
} from './utils';

describe('shouldStartInteractiveCli', () => {
  test('starts only for bare tokenleak in a TTY', () => {
    expect(shouldStartInteractiveCli([], true, true)).toBe(true);
    expect(shouldStartInteractiveCli(['--help'], true, true)).toBe(false);
    expect(shouldStartInteractiveCli([], false, true)).toBe(false);
    expect(shouldStartInteractiveCli([], true, false)).toBe(false);
  });
});

describe('clampScrollOffset', () => {
  test('clamps to valid range', () => {
    expect(clampScrollOffset(0, 100, 20)).toBe(0);
    expect(clampScrollOffset(-5, 100, 20)).toBe(0);
    expect(clampScrollOffset(90, 100, 20)).toBe(80);
    expect(clampScrollOffset(100, 100, 20)).toBe(80);
  });

  test('returns 0 when content fits viewport', () => {
    expect(clampScrollOffset(10, 5, 20)).toBe(0);
    expect(clampScrollOffset(0, 0, 20)).toBe(0);
  });

  test('handles edge: single line viewport', () => {
    expect(clampScrollOffset(5, 10, 1)).toBe(5);
    expect(clampScrollOffset(15, 10, 1)).toBe(9);
  });
});

describe('stripAnsi', () => {
  test('removes ANSI escape codes', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
    expect(stripAnsi('plain')).toBe('plain');
  });

  test('handles complex sequences', () => {
    expect(stripAnsi('\x1b[1;38;5;68mtest\x1b[0m')).toBe('test');
  });
});

describe('visibleLength', () => {
  test('returns length ignoring ANSI codes', () => {
    expect(visibleLength('\x1b[32mhello\x1b[0m')).toBe(5);
    expect(visibleLength('plain')).toBe(5);
  });
});

describe('buildCliArgTokens', () => {
  test('builds arg tokens from args object', () => {
    expect(buildCliArgTokens({ format: 'json', days: 30 })).toEqual(['--format', 'json', '--days', '30']);
  });

  test('omits false/null/undefined values', () => {
    expect(buildCliArgTokens({ format: undefined, days: false, more: null })).toEqual([]);
  });

  test('includes boolean true flags without value', () => {
    expect(buildCliArgTokens({ more: true })).toEqual(['--more']);
  });
});

describe('buildCliPreview', () => {
  test('returns tokenleak with no args', () => {
    expect(buildCliPreview({})).toBe('tokenleak');
  });

  test('includes flags', () => {
    expect(buildCliPreview({ format: 'json' })).toBe('tokenleak --format json');
  });
});

describe('finalizeCliArgs', () => {
  test('adds --more for compare + image format', () => {
    const args = finalizeCliArgs({ compare: 'auto', format: 'png' });
    expect(args['more']).toBe(true);
  });

  test('removes clipboard for png', () => {
    const args = finalizeCliArgs({ format: 'png', clipboard: true });
    expect(args['clipboard']).toBeUndefined();
  });

  test('auto-fills output when open is set for image format', () => {
    const args = finalizeCliArgs({ format: 'svg', open: true });
    expect(args['output']).toBe('tokenleak.svg');
  });
});

describe('describeRequest', () => {
  test('live server is inherit mode', () => {
    const desc = describeRequest({ liveServer: true });
    expect(desc.executionMode).toBe('inherit');
  });

  test('json is capture mode', () => {
    const desc = describeRequest({ format: 'json' });
    expect(desc.executionMode).toBe('capture');
  });

  test('compare has correct title', () => {
    const desc = describeRequest({ compare: 'auto' });
    expect(desc.title).toBe('Compare Report');
  });
});

describe('buildTabbedDashboardOptions', () => {
  test('infers time range from days', () => {
    const opts = buildTabbedDashboardOptions({ days: 7 }, [], null, false, false);
    expect(opts.initialTimeRange).toBe('7d');
  });

  test('infers time range from large day count', () => {
    const opts = buildTabbedDashboardOptions({ days: 200 }, [], null, false, false);
    expect(opts.initialTimeRange).toBe('365d');
  });

  test('sets provider names when provided', () => {
    const opts = buildTabbedDashboardOptions({}, ['claude-code'], null, false, false);
    expect(opts.providerNames).toEqual(['claude-code']);
  });

  test('sets width when provided', () => {
    const opts = buildTabbedDashboardOptions({}, [], 100, false, false);
    expect(opts.width).toBe(100);
  });
});

describe('computeDateRange', () => {
  test('computes range from days', () => {
    const range = computeDateRange({ days: 7, until: '2026-03-16' });
    expect(range.since).toBe('2026-03-09');
    expect(range.until).toBe('2026-03-16');
  });

  test('uses since/until directly', () => {
    const range = computeDateRange({ since: '2026-01-01', until: '2026-03-01' });
    expect(range.since).toBe('2026-01-01');
    expect(range.until).toBe('2026-03-01');
  });

  test('throws on invalid until date', () => {
    expect(() => computeDateRange({ until: '2026-13-45' })).toThrow('Invalid --until date');
  });

  test('throws on invalid since date', () => {
    expect(() => computeDateRange({ since: 'garbage' })).toThrow('Invalid --since date');
  });

  test('throws when since is after until', () => {
    expect(() => computeDateRange({ since: '2026-06-01', until: '2026-01-01' })).toThrow('must not be after');
  });
});
