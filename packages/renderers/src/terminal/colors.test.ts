import { describe, expect, it } from 'bun:test';
import {
  colorize256,
  bold256,
  inverse256,
  dim,
  bold,
  DOW_COLORS,
  TOD_COLORS,
  MODEL_COLORS,
  PROJECT_COLORS,
} from './colors';

describe('colorize256', () => {
  it('wraps text with 256-color ANSI code', () => {
    const result = colorize256('hello', 33, false);
    expect(result).toContain('\x1b[38;5;33m');
    expect(result).toContain('hello');
    expect(result).toContain('\x1b[0m');
  });

  it('returns plain text when noColor is true', () => {
    const result = colorize256('hello', 33, true);
    expect(result).toBe('hello');
  });
});

describe('bold256', () => {
  it('wraps text with bold + 256-color', () => {
    const result = bold256('test', 40, false);
    expect(result).toContain('\x1b[1;38;5;40m');
    expect(result).toContain('test');
    expect(result).toContain('\x1b[0m');
  });

  it('returns plain text when noColor is true', () => {
    expect(bold256('test', 40, true)).toBe('test');
  });
});

describe('inverse256', () => {
  it('wraps text with inverse + 256-color', () => {
    const result = inverse256('inv', 208, false);
    expect(result).toContain('\x1b[7;38;5;208m');
    expect(result).toContain('inv');
  });

  it('returns plain text when noColor is true', () => {
    expect(inverse256('inv', 208, true)).toBe('inv');
  });
});

describe('dim', () => {
  it('wraps text with dim ANSI', () => {
    const result = dim('faded', false);
    expect(result).toContain('\x1b[2m');
    expect(result).toContain('faded');
  });

  it('returns plain text when noColor is true', () => {
    expect(dim('faded', true)).toBe('faded');
  });
});

describe('bold', () => {
  it('wraps text with bold ANSI', () => {
    const result = bold('strong', false);
    expect(result).toContain('\x1b[1m');
    expect(result).toContain('strong');
  });

  it('returns plain text when noColor is true', () => {
    expect(bold('strong', true)).toBe('strong');
  });
});

describe('color palettes', () => {
  it('DOW_COLORS has 7 entries for each day of the week', () => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const day of days) {
      expect(DOW_COLORS[day]).toBeGreaterThan(0);
    }
    expect(Object.keys(DOW_COLORS)).toHaveLength(7);
  });

  it('TOD_COLORS has 5 entries for time-of-day buckets', () => {
    expect(Object.keys(TOD_COLORS)).toHaveLength(5);
    expect(TOD_COLORS['Morning']).toBeGreaterThan(0);
    expect(TOD_COLORS['Evening']).toBeGreaterThan(0);
  });

  it('MODEL_COLORS has 10 distinct entries', () => {
    expect(MODEL_COLORS).toHaveLength(10);
    expect(new Set(MODEL_COLORS).size).toBe(10);
  });

  it('PROJECT_COLORS has 10 distinct entries', () => {
    expect(PROJECT_COLORS).toHaveLength(10);
    expect(new Set(PROJECT_COLORS).size).toBe(10);
  });

  it('all palette values are valid 256-color codes (0-255)', () => {
    const allCodes = [
      ...Object.values(DOW_COLORS),
      ...Object.values(TOD_COLORS),
      ...MODEL_COLORS,
      ...PROJECT_COLORS,
    ];
    for (const code of allCodes) {
      expect(code).toBeGreaterThanOrEqual(0);
      expect(code).toBeLessThanOrEqual(255);
    }
  });
});
