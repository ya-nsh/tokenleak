import { Box, Text } from '@opentui/core';
import {
  CATEGORY_LABELS_SHORT,
  type Receipt,
  type ReceiptCategory,
  type ReceiptLine,
} from '@tokenleak/core';
import { formatCost, padRight, padLeft, truncate, wrapText } from '../lib/format.js';
import { deriveReceiptLines } from '../lib/data.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { ReceiptsSortMode } from '../lib/state.js';

const SORT_LABELS: Record<ReceiptsSortMode, string> = {
  cost: 'cost',
  qty: 'qty',
  alpha: 'alpha',
};

export const RECEIPTS_VISIBLE_ROWS = 8;
export const RECEIPTS_MAX_CONTENT_WIDTH = 78;
const SAMPLE_LIMIT = 3;
const SAMPLE_LINE_LIMIT = 2;

type ReceiptToggleHandler = (lineIndex: number) => void;

function renderLine(
  line: ReceiptLine,
  lineIndex: number,
  rank: number,
  descColWidth: number,
  isSelected: boolean,
  isExpanded: boolean,
  contentWidth: number,
  onToggleLine?: ReceiptToggleHandler,
) {
  const rankStr = padLeft(`${rank}.`, 3);
  const category = CATEGORY_LABELS_SHORT[line.category] ?? line.category.toUpperCase();
  const qty = `${line.quantity}×`;
  const cost = formatCost(line.totalCost);
  const desc = truncate(line.description, descColWidth);
  const pointer = isSelected ? '▸' : ' ';
  const expandIcon = isExpanded ? '▼' : '▶';
  const content = truncate(
    ` ${pointer} ${expandIcon} ${rankStr} ${padRight(category, 9)} ${padLeft(qty, 5)}  ${padRight(desc, descColWidth)} ${padLeft(cost, 10)}`,
    contentWidth,
  );

  return Box(
    {
      flexDirection: 'row',
      width: '100%',
      paddingLeft: 1,
      paddingRight: 1,
      onMouseDown: onToggleLine ? () => onToggleLine(lineIndex) : undefined,
    },
    Text({
      content,
      fg: isSelected ? COLORS.amber : COLORS.white,
      attributes: isSelected || isExpanded ? BOLD : undefined,
    }),
  );
}

function renderDetailLine(value: string, contentWidth: number, fg: string = COLORS.dimWhite) {
  return Text({ content: truncate(`      ${value}`, contentWidth), fg });
}

function renderSamplePrompt(prompt: string, contentWidth: number) {
  return wrapText(prompt, contentWidth - 10, SAMPLE_LINE_LIMIT).map((line, index) =>
    renderDetailLine(`${index === 0 ? '└ ' : '  '}${line}`, contentWidth),
  );
}

export function createReceiptsPanel(
  state: {
    receiptsScrollOffset: number;
    receiptsSelectedLineIndex: number;
    receiptsExpandedLineIndex: number | null;
    receiptsSortMode: ReceiptsSortMode;
    receiptsCategoryFilter: ReceiptCategory | null;
  },
  receipt: Receipt | null,
  contentWidth: number = RECEIPTS_MAX_CONTENT_WIDTH,
  onToggleLine?: ReceiptToggleHandler,
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
  const maxOffset = Math.max(0, derivedLines.length - RECEIPTS_VISIBLE_ROWS);
  const offset = Math.max(0, Math.min(state.receiptsScrollOffset, maxOffset));
  const visible = derivedLines.slice(offset, offset + RECEIPTS_VISIBLE_ROWS);

  const DESC_MIN = 20;
  const DESC_MAX = 38;
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
    Text({
      content: truncate(
        `     ${padRight('#', 3)} ${padRight('Bucket', 9)} ${padLeft('Qty', 5)}  ${padRight('Description', descColWidth)} ${padLeft('Cost', 10)}`,
        contentWidth,
      ),
      fg: COLORS.dimWhite,
    }),
  );

  const summary = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({
      content: `${receipt.summary.accountedPrompts} prompts captured · ${receipt.summary.unlabeledEvents} uncaptured events`,
      fg: COLORS.dimWhite,
    }),
  );

  // When a category filter is active, the visible rows only sum to a subset
  // of the receipt. Show that filtered subtotal alongside the unfiltered
  // totals so the numbers can't be misread against the table above — and
  // label the unfiltered line explicitly as "all".
  const filterActive = state.receiptsCategoryFilter !== null;
  const filteredSubtotal = filterActive
    ? derivedLines.reduce((sum, l) => sum + l.totalCost, 0)
    : receipt.summary.subtotal;

  const totalsRow = filterActive
    ? Box(
        { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
        Box(
          { flexDirection: 'row', width: '100%' },
          Text({
            content: `Filtered subtotal (${filterLabel}) `,
            fg: COLORS.dimWhite,
          }),
          Text({
            content: formatCost(filteredSubtotal),
            fg: COLORS.amber,
            attributes: BOLD,
          }),
        ),
        ...wrapText(
          `All categories · Subtotal ${formatCost(receipt.summary.subtotal)}  ·  Service fees ${formatCost(receipt.summary.serviceFees)}  ·  Total ${formatCost(receipt.summary.total)}`,
          contentWidth - 2,
          2,
        ).map((line) => Text({ content: line, fg: COLORS.dimWhite })),
      )
    : Box(
        { flexDirection: 'column', width: '100%', paddingLeft: 1, paddingRight: 1 },
        ...wrapText(
          `Subtotal ${formatCost(receipt.summary.subtotal)}  ·  Service fees ${formatCost(receipt.summary.serviceFees)}  ·  Total ${formatCost(receipt.summary.total)}`,
          contentWidth - 2,
          2,
        ).map((line) => Text({ content: line, fg: COLORS.dimWhite })),
      );

  const expandedIndex = state.receiptsExpandedLineIndex;
  const rows: ReturnType<typeof Box | typeof Text>[] = [];
  for (let i = 0; i < visible.length; i++) {
    const absoluteIndex = offset + i;
    const isExpanded = expandedIndex === absoluteIndex;
    const isSelected = state.receiptsSelectedLineIndex === absoluteIndex;
    rows.push(renderLine(
      visible[i]!,
      absoluteIndex,
      absoluteIndex + 1,
      descColWidth,
      isSelected,
      isExpanded,
      contentWidth,
      onToggleLine,
    ));
    if (isExpanded) {
      const samples = visible[i]!.samplePrompts;
      if (samples.length === 0) {
        rows.push(renderDetailLine('└ No sample prompts available for this line.', contentWidth));
      } else {
        const visibleSamples = samples.slice(0, SAMPLE_LIMIT);
        for (const sample of visibleSamples) {
          rows.push(...renderSamplePrompt(sample, contentWidth));
        }
        if (samples.length > visibleSamples.length) {
          rows.push(renderDetailLine(`+${samples.length - visibleSamples.length} more samples`, contentWidth));
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
