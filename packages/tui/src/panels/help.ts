import { Box, Text } from '@opentui/core';
import { COLORS, BOLD } from '../lib/theme.js';

function helpSection(title: string, items: [string, string][]) {
  const children: ReturnType<typeof Box | typeof Text>[] = [
    Text({ content: title, fg: COLORS.amber, attributes: BOLD }),
    Text({ content: '', fg: COLORS.dimWhite }),
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

  children.push(Text({ content: '', fg: COLORS.dimWhite }));
  return children;
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
          ['\u2192', 'Next view'],
          ['\u2190', 'Prev view'],
          ['Tab / >', 'Next time period'],
          ['Shift+Tab / <', 'Prev time period'],
          ['j / \u2193', 'Scroll down'],
          ['k / \u2191', 'Scroll up'],
          ['[ / ]', 'Matrix page (in Matrix)'],
        ]),
        ...helpSection('ACTIONS', [
          ['s', 'Toggle sort mode'],
          ['r', 'Refresh data'],
          ['c', 'Open Cursor setup'],
          ['q', 'Quit'],
        ]),
        ...helpSection('EXPORT VIEW', [
          ['p', 'Save PNG'],
          ['w', 'Save Wrapped PNG'],
          ['l', 'Launch Live Server'],
        ]),
      ),

      // Right column
      Box(
        { flexDirection: 'column', flexGrow: 1 },
        ...helpSection('VIEWS', [
          ['1', 'Overview'],
          ['2', 'Matrix'],
          ['3', 'Advisor'],
          ['4', 'Focus'],
          ['5', 'Explain'],
          ['6', 'Compare'],
          ['7', 'Export'],
          ['8', 'Wrapped'],
          ['9', 'Replay'],
          ['R', 'Receipts'],
          ['?', 'Help'],
        ]),
        ...helpSection('EXPLAIN VIEW', [
          ['h', 'Previous day'],
          ['l', 'Next day'],
        ]),
        ...helpSection('RECEIPTS VIEW', [
          ['j / k', 'Scroll line items'],
          ['enter', 'Expand top line into sample prompts'],
        ]),
      ),
    ),

    Text({ content: '                  Press ? or Esc to close', fg: COLORS.dimWhite }),
  );
}
