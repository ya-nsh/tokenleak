import { afterEach, describe, expect, test } from 'bun:test';
import {
  defaultTerminalWidth,
  extractGlobalFlags,
  isVerbose,
  setVerbose,
  shouldUseColor,
} from './output-mode';

afterEach(() => {
  setVerbose(false);
});

describe('shouldUseColor', () => {
  test('colors a TTY', () => {
    expect(shouldUseColor({ isTTY: true }, {})).toBe(true);
  });

  test('does not color pipes and files', () => {
    expect(shouldUseColor({ isTTY: false }, {})).toBe(false);
    expect(shouldUseColor({}, {})).toBe(false);
  });

  test('NO_COLOR wins over a TTY', () => {
    expect(shouldUseColor({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
  });

  test('an empty NO_COLOR is ignored, per no-color.org', () => {
    expect(shouldUseColor({ isTTY: true }, { NO_COLOR: '' })).toBe(true);
  });

  test('FORCE_COLOR colors a pipe; FORCE_COLOR=0 does not', () => {
    expect(shouldUseColor({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
    expect(shouldUseColor({ isTTY: false }, { FORCE_COLOR: '0' })).toBe(false);
  });

  test('NO_COLOR beats FORCE_COLOR', () => {
    expect(shouldUseColor({ isTTY: true }, { NO_COLOR: '1', FORCE_COLOR: '1' })).toBe(false);
  });
});

describe('defaultTerminalWidth', () => {
  test('uses the terminal width', () => {
    expect(defaultTerminalWidth({ isTTY: true, columns: 120 })).toBe(120);
  });

  test('clamps very narrow and very wide terminals', () => {
    expect(defaultTerminalWidth({ isTTY: true, columns: 20 })).toBe(40);
    expect(defaultTerminalWidth({ isTTY: true, columns: 300 })).toBe(140);
  });

  test('falls back to 80 when piped or columns are unknown', () => {
    expect(defaultTerminalWidth({ isTTY: false, columns: 200 })).toBe(80);
    expect(defaultTerminalWidth({ isTTY: true })).toBe(80);
    expect(defaultTerminalWidth({ isTTY: true, columns: 0 })).toBe(80);
  });
});

describe('extractGlobalFlags', () => {
  test('strips --verbose wherever it appears', () => {
    expect(extractGlobalFlags(['explain', '--verbose', 'today'])).toEqual({
      argv: ['explain', 'today'],
      verbose: true,
    });
  });

  test('leaves other arguments untouched', () => {
    expect(extractGlobalFlags(['--days', '7'])).toEqual({ argv: ['--days', '7'], verbose: false });
  });

  test('setVerbose toggles the shared flag', () => {
    setVerbose(true);
    expect(isVerbose()).toBe(true);
  });
});
