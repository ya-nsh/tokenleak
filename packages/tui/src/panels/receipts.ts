import { Box, Text } from '@opentui/core';
import {
  CATEGORY_LABELS_SHORT,
  type Receipt,
  type ReceiptCategory,
  type ReceiptLine,
} from '@tokenleak/core';
import { formatCost, padRight, padLeft, truncate } from '../lib/format.js';
import { deriveReceiptLines } from '../lib/data.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { ReceiptsSortMode } from '../lib/state.js';

const SORT_LABELS: Record<ReceiptsSortMode, string> = {
  cost: 'cost',
  qty: 'qty',
  alpha: 'alpha',
};

const VISIBLE_ROWS = 12;

function renderLine(line: ReceiptLine, rank: number, descColWidth: number, isExpanded: boolean) {
  const rankStr = padLeft(`${rank}.`, 3);
  const category = CATEGORY_LABELS_SHORT[line.category] ?? line.category.toUpperCase();
  const qty = `${line.quantity}×`;
  const cost = formatCost(line.totalCost);
  const desc = truncate(line.description, descColWidth);
  // Arrow indicator on the expanded line so the cursor position is obvious.
  const pointer = isExpanded ? '▸' : ' ';

  return Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({
      content: `${pointer}${rankStr} `,
      fg: isExpanded ? COLORS.amber : COLORS.dimWhite,
      attributes: isExpanded ? BOLD : undefined,
    }),
    Text({ content: padRight(category, 9), fg: COLORS.amber, attributes: BOLD }),
    Text({ content: padLeft(qty, 5), fg: COLORS.cyan }),
    Text({ content: `  ${padRight(desc, descColWidth)}`, fg: COLORS.white }),
    Text({ content: padLeft(cost, 10), fg: COLORS.green }),
  );
}

function renderSamplePrompt(prompt: string, descColWidth: number) {
  const indent = 6; // align under the description column
  const width = Math.max(10, descColWidth - 2);
  const text = truncate(prompt, width);
  return Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: ' '.repeat(indent), fg: COLORS.dimWhite }),
    Text({ content: '└ ', fg: COLORS.dimWhite }),
    Text({ content: text, fg: COLORS.dimWhite }),
  );
}

export function createReceiptsPanel(
  state: {
    receiptsScrollOffset: number;
    receiptsExpandedLineIndex: number | null;
    receiptsSortMode: ReceiptsSortMode;
    receiptsCategoryFilter: ReceiptCategory | null;
  },
  receipt: Receipt | null,
) {
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

  const derivedLines = deriveReceiptLines(
    receipt,
    state.receiptsSortMode,
    state.receiptsCategoryFilter,
  );
  const offset = state.receiptsScrollOffset;
  const visible = derivedLines.slice(offset, offset + VISIBLE_ROWS);

  const DESC_MIN = 20;
  const DESC_MAX = 52;
  const longest = Math.max(DESC_MIN, ...visible.map((l) => l.description.length));
  const descColWidth = Math.min(DESC_MAX, longest);

  const scrollIndicators: ReturnType<typeof Text>[] = [];
  if (offset > 0) {
    scrollIndicators.push(Text({ content: `  ${offset} more above`, fg: COLORS.dimWhite }));
  }
  const below = derivedLines.length - offset - visible.length;
  if (below > 0) {
    scrollIndicators.push(Text({ content: `  ${below} more below`, fg: COLORS.dimWhite }));
  }

  const filterLabel = state.receiptsCategoryFilter
    ? (CATEGORY_LABELS_SHORT[state.receiptsCategoryFilter] ?? state.receiptsCategoryFilter)
    : 'all';
  const titleSuffix = ` · sort: ${SORT_LABELS[state.receiptsSortMode]} · filter: ${filterLabel}`;
  const titleRow = Box(
    { flexDirection: 'row', width: '100%' },
    Text({ content: ' Receipts', fg: COLORS.amber, attributes: BOLD }),
    Text({ content: titleSuffix, fg: COLORS.dimWhite }),
  );

  // Empty-after-filter guard: we already know the receipt has lines; this
  // branch only fires when the filter narrowed everything away.
  if (derivedLines.length === 0) {
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
      titleRow,
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({
        content: `No receipt lines match the current filter (${filterLabel}). Press f to cycle.`,
        fg: COLORS.dimWhite,
      }),
    );
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

  const expandedIndex = state.receiptsExpandedLineIndex;
  const rows: ReturnType<typeof Box | typeof Text>[] = [];
  for (let i = 0; i < visible.length; i++) {
    const absoluteIndex = offset + i;
    const isExpanded = expandedIndex === absoluteIndex;
    rows.push(renderLine(visible[i]!, absoluteIndex + 1, descColWidth, isExpanded));
    if (isExpanded) {
      const samples = visible[i]!.samplePrompts;
      if (samples.length === 0) {
        rows.push(
          Box(
            { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
            Text({ content: '      ', fg: COLORS.dimWhite }),
            Text({ content: '└ ', fg: COLORS.dimWhite }),
            Text({ content: 'No sample prompts available for this line.', fg: COLORS.dimWhite }),
          ),
        );
      } else {
        for (const sample of samples) {
          rows.push(renderSamplePrompt(sample, descColWidth));
        }
      }
    }
  }

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    titleRow,
    summary,
    Text({ content: '', fg: COLORS.dimWhite }),
    columnHeader,
    ...rows,
    ...scrollIndicators,
    Text({ content: '', fg: COLORS.dimWhite }),
    totalsRow,
  );
}
