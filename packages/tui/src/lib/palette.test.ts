import { describe, expect, test } from 'bun:test';
import { PALETTE_OPEN_KEYS, fuzzyScore, matchPalette, paletteInput } from './palette';
import type { PaletteEntry, PaletteState } from './palette';

const ENTRIES: PaletteEntry[] = [
  { id: 'view:overview', title: 'Overview', group: 'View', hint: '1' },
  { id: 'view:matrix', title: 'Spend › Matrix', group: 'View', hint: '2' },
  { id: 'view:receipts', title: 'Savings › Receipts', group: 'View', hint: 'R' },
  { id: 'window:1', title: 'Last 7 days', group: 'Period', keywords: '7D' },
  { id: 'action:refresh', title: 'Refresh usage data', group: 'Action', keywords: 'reload' },
];
const isEscape = (sequence: string) => sequence === '\x1b';
const state = (query: string, selected = 0): PaletteState => ({ query, selected });

describe('fuzzyScore', () => {
  test('matches subsequences case-insensitively and reports positions', () => {
    expect(fuzzyScore('mtx', 'Matrix')?.positions).toEqual([0, 2, 5]);
    expect(fuzzyScore('xyz', 'Matrix')).toBeNull();
  });

  test('prefers consecutive runs and word starts', () => {
    expect(fuzzyScore('rec', 'Receipts')!.score).toBeGreaterThan(fuzzyScore('rec', 'Refresh cache')!.score);
  });

  test('an empty or whitespace query matches with score 0', () => {
    expect(fuzzyScore('  ', 'anything')).toEqual({ score: 0, positions: [] });
  });
});

describe('matchPalette', () => {
  test('lists every entry in order for an empty query', () => {
    expect(matchPalette(ENTRIES, '').map((m) => m.entry.id)).toEqual(ENTRIES.map((e) => e.id));
  });

  test('ranks the best title match first', () => {
    expect(matchPalette(ENTRIES, 'matrix')[0]!.entry.id).toBe('view:matrix');
    expect(matchPalette(ENTRIES, 'rcpt')[0]!.entry.id).toBe('view:receipts');
  });

  test('finds entries by group and keywords', () => {
    expect(matchPalette(ENTRIES, 'reload').map((m) => m.entry.id)).toEqual(['action:refresh']);
    expect(matchPalette(ENTRIES, '7d')[0]!.entry.id).toBe('window:1');
    expect(matchPalette(ENTRIES, 'period').map((m) => m.entry.id)).toEqual(['window:1']);
  });

  test('returns nothing when no entry matches', () => {
    expect(matchPalette(ENTRIES, 'qqqq')).toEqual([]);
  });
});

describe('paletteInput', () => {
  test('typing edits the query and resets the selection', () => {
    expect(paletteInput(state('ma', 2), 't', ENTRIES, isEscape)).toEqual({ kind: 'update', state: state('mat') });
    expect(paletteInput(state('ma'), 'trix', ENTRIES, isEscape)).toEqual({ kind: 'update', state: state('matrix') });
  });

  test('backspace removes one character and Ctrl+U clears', () => {
    expect(paletteInput(state('mat'), '\x7f', ENTRIES, isEscape)).toEqual({ kind: 'update', state: state('ma') });
    expect(paletteInput(state(''), '\x7f', ENTRIES, isEscape)).toEqual({ kind: 'update', state: state('') });
    expect(paletteInput(state('mat'), '\x15', ENTRIES, isEscape)).toEqual({ kind: 'update', state: state('') });
  });

  test('arrows and Ctrl+N/P move the selection and wrap', () => {
    expect(paletteInput(state('', 0), '\x1b[B', ENTRIES, isEscape)).toEqual({ kind: 'update', state: state('', 1) });
    expect(paletteInput(state('', 0), '\x1b[A', ENTRIES, isEscape)).toEqual({ kind: 'update', state: state('', 4) });
    expect(paletteInput(state('', 4), '\x0e', ENTRIES, isEscape)).toEqual({ kind: 'update', state: state('', 0) });
    expect(paletteInput(state('qqqq'), '\x1b[B', ENTRIES, isEscape)).toEqual({ kind: 'ignore' });
  });

  test('enter runs the selected match, and nothing when there are no matches', () => {
    expect(paletteInput(state('matrix'), '\r', ENTRIES, isEscape)).toEqual({ kind: 'run', id: 'view:matrix' });
    expect(paletteInput(state('', 3), '\r', ENTRIES, isEscape)).toEqual({ kind: 'run', id: 'window:1' });
    expect(paletteInput(state('qqqq'), '\r', ENTRIES, isEscape)).toEqual({ kind: 'ignore' });
  });

  test('escape closes and other control sequences are ignored', () => {
    expect(paletteInput(state('x'), '\x1b', ENTRIES, isEscape)).toEqual({ kind: 'close' });
    expect(paletteInput(state('x'), '\x1b[C', ENTRIES, isEscape)).toEqual({ kind: 'ignore' });
    expect(paletteInput(state('x'), '\t', ENTRIES, isEscape)).toEqual({ kind: 'ignore' });
  });

  test('opens on slash, colon and Ctrl+K only', () => {
    expect([...PALETTE_OPEN_KEYS].sort()).toEqual(['/', ':', '\x0b'].sort());
  });
});
