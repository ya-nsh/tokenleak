/** Rows the header, the sub-tab bar and the footer take from every view. */
export const CHROME_ROWS = 3;

/** Rows left for the active view after the chrome and the optional Cursor banner. */
export function contentRows(terminalHeight: number, hasCursorBanner: boolean): number {
  return Math.max(0, terminalHeight - CHROME_ROWS - Number(hasCursorBanner));
}

/**
 * How many items of `rowsPerItem` rows fit in `height` after `fixedRows`.
 * At least one, since a cramped page beats an empty one, and at most `max`.
 * An unknown height (tests, the first frame) fits `max`.
 */
export function fitItems(
  height: number,
  fixedRows: number,
  rowsPerItem: number,
  max: number,
): number {
  if (!Number.isFinite(height)) return max;
  return Math.max(1, Math.min(max, Math.floor((height - fixedRows) / rowsPerItem)));
}
