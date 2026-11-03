import { Box, StyledText, Text, bg, fg } from '@opentui/core';
import type { TextChunk } from '@opentui/core';
import { padLeft, padRight, truncate } from '../lib/format.js';
import type { PaletteEntry, PaletteState } from '../lib/palette.js';
import { matchPalette } from '../lib/palette.js';
import { BOLD, COLORS, rgba } from '../lib/theme.js';

/** Border (2), query line, rule and footer. */
const PALETTE_CHROME_ROWS = 5;
const GROUP_WIDTH = 10;
const HINT_WIDTH = 8;
/** Border and padding on both sides. */
const PANEL_CHROME_COLS = 4;

/** How many matches fit in a palette `height` rows tall. */
export function paletteVisibleRows(height: number): number {
  return Math.max(1, height - PALETTE_CHROME_ROWS);
}

function highlightTitle(title: string, positions: readonly number[], width: number, selected: boolean): TextChunk[] {
  const shown = truncate(title, width);
  const marks = new Set(positions);
  const chunks: TextChunk[] = [];
  [...padRight(shown, width)].forEach((char, index) => {
    const color = marks.has(index) && index < shown.length ? COLORS.amber : COLORS.white;
    let chunk = fg(rgba(color))(char);
    if (selected) chunk = bg(rgba(COLORS.border))(chunk);
    chunks.push(chunk);
  });
  return chunks;
}

/**
 * The command palette: a query line and the best matches, with the matched
 * letters highlighted and the selected row shaded. Rows scroll to keep the
 * selection visible.
 */
export function createPalettePanel(
  palette: PaletteState,
  entries: readonly PaletteEntry[],
  width: number,
  height: number,
) {
  const matches = matchPalette(entries, palette.query);
  const rows = paletteVisibleRows(height);
  const selected = Math.min(palette.selected, Math.max(0, matches.length - 1));
  const start = Math.max(0, Math.min(selected - rows + 1, matches.length - rows));
  const visible = matches.slice(Math.max(0, start), Math.max(0, start) + rows);
  const titleWidth = Math.max(10, width - PANEL_CHROME_COLS - 2 - GROUP_WIDTH - HINT_WIDTH);

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      border: true,
      borderStyle: 'rounded',
      borderColor: COLORS.amber,
      title: ' Go to… ',
      paddingLeft: 1,
      paddingRight: 1,
    },
    Text({
      wrapMode: 'none',
      flexShrink: 0,
      content: new StyledText([
        fg(rgba(COLORS.amber))('› '),
        fg(rgba(COLORS.white))(palette.query),
        bg(rgba(COLORS.amber))(' '),
      ]),
    }),
    Text({ content: '─'.repeat(Math.max(0, width - PANEL_CHROME_COLS)), fg: COLORS.border, wrapMode: 'none', flexShrink: 0 }),
    ...(visible.length === 0
      ? [Text({ content: `  No command matches “${palette.query}”.`, fg: COLORS.dimWhite, flexShrink: 0 })]
      : visible.map((match, index) => {
          const isSelected = Math.max(0, start) + index === selected;
          const shade = (chunk: TextChunk) => (isSelected ? bg(rgba(COLORS.border))(chunk) : chunk);
          return Text({
            wrapMode: 'none',
            flexShrink: 0,
            content: new StyledText([
              shade(fg(rgba(isSelected ? COLORS.amber : COLORS.dimWhite))(isSelected ? '▸ ' : '  ')),
              shade(fg(rgba(COLORS.dimWhite))(padRight(truncate(match.entry.group, GROUP_WIDTH - 1), GROUP_WIDTH))),
              ...highlightTitle(match.entry.title, match.positions, titleWidth, isSelected),
              shade(fg(rgba(COLORS.cyan))(padLeft(match.entry.hint ?? '', HINT_WIDTH))),
            ]),
          });
        })),
    Box({ flexGrow: 1 }),
    Text({
      content: `  ${matches.length} of ${entries.length}   ↑↓ select   enter run   esc close`,
      fg: COLORS.dimWhite,
      attributes: BOLD,
      wrapMode: 'none',
      flexShrink: 0,
    }),
  );
}
