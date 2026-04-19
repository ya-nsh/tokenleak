import { Box, Text } from '@opentui/core';
import { CATEGORY_LABELS_SHORT, type Receipt, type ReceiptLine } from '@tokenleak/core';
import { formatCost, padRight, padLeft, truncate } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';

const VISIBLE_ROWS = 12;

function renderLine(line: ReceiptLine, rank: number, descColWidth: number) {
  const rankStr = padLeft(`${rank}.`, 3);
  const category = CATEGORY_LABELS_SHORT[line.category] ?? line.category.toUpperCase();
  const qty = `${line.quantity}×`;
  const cost = formatCost(line.totalCost);
  const desc = truncate(line.description, descColWidth);

  return Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: `${rankStr} `, fg: COLORS.dimWhite }),
    Text({ content: padRight(category, 9), fg: COLORS.amber, attributes: BOLD }),
    Text({ content: padLeft(qty, 5), fg: COLORS.cyan }),
    Text({ content: `  ${padRight(desc, descColWidth)}`, fg: COLORS.white }),
    Text({ content: padLeft(cost, 10), fg: COLORS.green }),
  );
}

export function createReceiptsPanel(state: { receiptsScrollOffset: number }, receipt: Receipt | null) {
  if (!receipt || receipt.lines.length === 0) {
    return Box(
      {
        flexDirection: 'column',
        width: '100%',
        flexGrow: 1,
        borderStyle: 'single',
        borderColor: COLORS.dimWhite,
        paddingLeft: 1,
        paddingRight: 1,
      },
      Text({ content: ' Receipts ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({
        content: 'No itemized prompts captured in this window.',
        fg: COLORS.dimWhite,
      }),
      Text({
        content: 'Prompt capture currently only works for Claude Code logs.',
        fg: COLORS.dimWhite,
      }),
      Text({
        content: 'Run Claude Code locally to generate logs with prompt text, then press r to refresh.',
        fg: COLORS.dimWhite,
      }),
    );
  }

  const offset = state.receiptsScrollOffset;
  const visible = receipt.lines.slice(offset, offset + VISIBLE_ROWS);

  const DESC_MIN = 20;
  const DESC_MAX = 52;
  const longest = Math.max(DESC_MIN, ...visible.map((l) => l.description.length));
  const descColWidth = Math.min(DESC_MAX, longest);

  const scrollIndicators: ReturnType<typeof Text>[] = [];
  if (offset > 0) {
    scrollIndicators.push(Text({ content: `  ${offset} more above`, fg: COLORS.dimWhite }));
  }
  const below = receipt.lines.length - offset - visible.length;
  if (below > 0) {
    scrollIndicators.push(Text({ content: `  ${below} more below`, fg: COLORS.dimWhite }));
  }

  const columnHeader = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: padRight('', 4), fg: COLORS.dimWhite }),
    Text({ content: padRight('Bucket', 9), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Qty', 5), fg: COLORS.dimWhite }),
    Text({ content: `  ${padRight('Description', descColWidth)}`, fg: COLORS.dimWhite }),
    Text({ content: padLeft('Cost', 10), fg: COLORS.dimWhite }),
  );

  const summary = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({
      content: `${receipt.summary.accountedPrompts} prompts captured · ${receipt.summary.unlabeledEvents} uncaptured events`,
      fg: COLORS.dimWhite,
    }),
  );

  const totalsRow = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({
      content: `Subtotal ${formatCost(receipt.summary.subtotal)}  ·  Service fees ${formatCost(receipt.summary.serviceFees)}  ·  `,
      fg: COLORS.dimWhite,
    }),
    Text({ content: `Total ${formatCost(receipt.summary.total)}`, fg: COLORS.amber, attributes: BOLD }),
  );

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    Text({ content: ' Receipts ', fg: COLORS.amber, attributes: BOLD }),
    summary,
    Text({ content: '', fg: COLORS.dimWhite }),
    columnHeader,
    ...visible.map((l, i) => renderLine(l, offset + i + 1, descColWidth)),
    ...scrollIndicators,
    Text({ content: '', fg: COLORS.dimWhite }),
    totalsRow,
  );
}
