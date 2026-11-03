/** One command in the palette. `id` is what the TUI runs when it is chosen. */
export interface PaletteEntry {
  id: string;
  title: string;
  /** Section shown beside the title, e.g. "View" or "Period". */
  group: string;
  /** Direct key for the same command, shown as a hint. */
  hint?: string;
  /** Extra words that should find this entry. */
  keywords?: string;
}

export interface PaletteState {
  query: string;
  /** Index into the current matches. */
  selected: number;
}

export interface PaletteMatch {
  entry: PaletteEntry;
  score: number;
  /** Positions in `entry.title` that matched, for highlighting. */
  positions: number[];
}

/** Bonus for a match right after the previous one. */
const CONSECUTIVE_BONUS = 5;
/** Bonus for a match at the start of a word. */
const WORD_START_BONUS = 8;
/** Penalty per character skipped before a match. */
const GAP_PENALTY = 1;
/** Title matches outrank keyword-only matches. */
const TITLE_BONUS = 20;

/**
 * Scores `query` as a case-insensitive subsequence of `text`, preferring
 * consecutive runs and word starts. Returns null when it does not match.
 */
export function fuzzyScore(query: string, text: string): { score: number; positions: number[] } | null {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (needle.length === 0) return { score: 0, positions: [] };
  const haystack = text.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let from = 0;
  for (const char of needle) {
    const index = haystack.indexOf(char, from);
    if (index === -1) return null;
    const previous = positions.at(-1);
    if (previous !== undefined && index === previous + 1) score += CONSECUTIVE_BONUS;
    if (index === 0 || /[\s›:/_-]/.test(haystack[index - 1]!)) score += WORD_START_BONUS;
    score -= (index - from) * GAP_PENALTY;
    positions.push(index);
    from = index + 1;
  }
  return { score, positions };
}

/** Entries matching `query`, best first; every entry in order when the query is empty. */
export function matchPalette(entries: readonly PaletteEntry[], query: string): PaletteMatch[] {
  if (query.trim().length === 0) return entries.map((entry) => ({ entry, score: 0, positions: [] }));
  const matches: PaletteMatch[] = [];
  for (const entry of entries) {
    const title = fuzzyScore(query, `${entry.group} ${entry.title}`);
    const titleOnly = fuzzyScore(query, entry.title);
    const keywords = entry.keywords ? fuzzyScore(query, entry.keywords) : null;
    const best = [
      titleOnly && { score: titleOnly.score + TITLE_BONUS, positions: titleOnly.positions },
      title && { score: title.score, positions: [] },
      keywords && { score: keywords.score, positions: [] },
    ]
      .filter((candidate): candidate is { score: number; positions: number[] } => Boolean(candidate))
      .sort((a, b) => b.score - a.score)[0];
    if (best) matches.push({ entry, ...best });
  }
  return matches.sort((a, b) => b.score - a.score);
}

const BACKSPACE_SEQUENCES = new Set(['\x7f', '\b']);
const UP_SEQUENCES = new Set(['\x1b[A', '\x10']); // Up, Ctrl+P
const DOWN_SEQUENCES = new Set(['\x1b[B', '\x0e']); // Down, Ctrl+N
const ENTER_SEQUENCES = new Set(['\r', '\n']);
/** Ctrl+U clears the query, as in a shell. */
const CLEAR_SEQUENCE = '\x15';

export type PaletteInput =
  | { kind: 'update'; state: PaletteState }
  | { kind: 'run'; id: string }
  | { kind: 'close' }
  | { kind: 'ignore' };

/**
 * Applies one key to the palette: printable text edits the query, arrows and
 * Ctrl+N/P move the selection (wrapping), Enter runs the selected entry, and
 * `isEscape` keys close it.
 */
export function paletteInput(
  state: PaletteState,
  sequence: string,
  entries: readonly PaletteEntry[],
  isEscape: (sequence: string) => boolean,
): PaletteInput {
  const matches = matchPalette(entries, state.query);
  if (isEscape(sequence)) return { kind: 'close' };
  if (ENTER_SEQUENCES.has(sequence)) {
    const match = matches[Math.min(state.selected, matches.length - 1)];
    return match ? { kind: 'run', id: match.entry.id } : { kind: 'ignore' };
  }
  if (UP_SEQUENCES.has(sequence) || DOWN_SEQUENCES.has(sequence)) {
    if (matches.length === 0) return { kind: 'ignore' };
    const step = UP_SEQUENCES.has(sequence) ? -1 : 1;
    return { kind: 'update', state: { ...state, selected: (state.selected + step + matches.length) % matches.length } };
  }
  if (BACKSPACE_SEQUENCES.has(sequence)) {
    return { kind: 'update', state: { query: [...state.query].slice(0, -1).join(''), selected: 0 } };
  }
  if (sequence === CLEAR_SEQUENCE) return { kind: 'update', state: { query: '', selected: 0 } };
  // Printable text, including a pasted run; control and escape sequences are ignored.
  if (sequence.length > 0 && !/[\x00-\x1f\x7f]/.test(sequence)) {
    return { kind: 'update', state: { query: state.query + sequence, selected: 0 } };
  }
  return { kind: 'ignore' };
}

/** Keys that open the palette from anywhere: `/`, `:` and Ctrl+K. */
export const PALETTE_OPEN_KEYS: ReadonlySet<string> = new Set(['/', ':', '\x0b']);
