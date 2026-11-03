import { Box, Text } from '@opentui/core';
import { COLORS, BOLD } from '../lib/theme.js';
import { DIRECT_VIEW_KEYS, VIEW_GROUPS } from '../lib/views.js';

/** Shortcut letters per help row, so the row fits half a 100-column terminal. */
const DIRECT_KEYS_PER_ROW = 3;

/**
 * A titled list of key bindings. Sections are compact (no blank under the
 * title) so the whole overlay fits a 36-row terminal; the last section in a
 * column drops its trailing blank too.
 */
function helpSection(title: string, items: [string, string][], last = false) {
  const children: ReturnType<typeof Box | typeof Text>[] = [
    Text({ content: title, fg: COLORS.amber, attributes: BOLD }),
  ];

  for (const [key, desc] of items) {
    children.push(
      Box(
        { flexDirection: 'row', width: '100%' },
        Text({ content: `  ${key.padEnd(14)}`, fg: COLORS.cyan, attributes: BOLD }),
        Text({ content: desc, fg: COLORS.white }),
      ),
    );
  }

  if (!last) children.push(Text({ content: '', fg: COLORS.dimWhite }));
  return children;
}

/** The letter shortcuts as help rows: keys on the left, their tab labels on the right. */
function directKeyRows(): [string, string][] {
  const labels = new Map(
    VIEW_GROUPS.flatMap((group) => group.views.map((view) => [view.mode, view.label] as const)),
  );
  const entries = Object.entries(DIRECT_VIEW_KEYS);
  const rows: [string, string][] = [];
  for (let start = 0; start < entries.length; start += DIRECT_KEYS_PER_ROW) {
    const chunk = entries.slice(start, start + DIRECT_KEYS_PER_ROW);
    rows.push([
      chunk.map(([key]) => key).join(' '),
      chunk.map(([, mode]) => labels.get(mode) ?? mode).join(', '),
    ]);
  }
  return rows;
}

export function createHelpPanel() {
  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.amber,
      padding: 1,
    },
    Text({ content: ' HELP ', fg: COLORS.amber, attributes: BOLD }),
    Text({ content: '', fg: COLORS.dimWhite }),

    Box(
      { flexDirection: 'row', width: '100%', flexGrow: 1 },

      // Left column
      Box(
        { flexDirection: 'column', flexGrow: 1 },
        ...helpSection('NAVIGATION', [
          ['1-6', 'Switch group'],
          ['1-6 again', 'Next tab in the group'],
          ['\u2192 / \u2190', 'Next / prev tab (all groups)'],
          ['Tab / >', 'Next time period'],
          ['Shift+Tab / <', 'Prev time period'],
          ['j / \u2193', 'Scroll down'],
          ['k / \u2191', 'Scroll up'],
          ['[ / ]', 'Matrix page (in Matrix)'],
        ]),
        ...helpSection('ACTIONS', [
          ['s', 'Toggle sort mode'],
          ['r', 'Refresh data'],
          ['o', 'Open browser replay (any view)'],
          ['c', 'Open Cursor setup'],
          ['q', 'Quit'],
        ]),
        ...helpSection('EXPORT VIEW', [
          ['p', 'Save PNG'],
          ['w', 'Save Wrapped PNG'],
          ['l', 'Open AI Wrapped in the browser'],
          ['a', 'Copy LLM prompt'],
        ]),
        ...helpSection(
          'EXPLAIN VIEW',
          [
            ['h', 'Previous day'],
            ['l', 'Next day'],
          ],
          true,
        ),
      ),

      // Right column
      Box(
        { flexDirection: 'column', flexGrow: 1 },
        ...helpSection('VIEWS', [
          ...VIEW_GROUPS.map((group): [string, string] => [
            `${group.key} ${group.label}`,
            group.views.map((view) => view.label).join(' '),
          ]),
          ...directKeyRows(),
          ['?', 'Help'],
        ]),
        ...helpSection('REPLAY VIEW', [
          ['h / l', 'Previous / next day'],
          ['j / k', 'Select flow block'],
          ['Enter / Space', 'Toggle selected flow block'],
          ['Click', 'Select and toggle a flow block'],
        ]),
        ...helpSection(
          'RECEIPTS VIEW',
          [
            ['j / k', 'Select line item'],
            ['Enter / Space', 'Toggle selected line item'],
            ['Click', 'Select and toggle a line item'],
            ['S', 'Cycle sort (cost / qty / alpha)'],
            ['f', 'Cycle category filter'],
          ],
          true,
        ),
      ),
    ),

    Text({ content: '                  Press ? or Esc to close', fg: COLORS.dimWhite }),
  );
}
