import type { Receipt, ReceiptLine, UsageEvent } from '@tokenleak/core';

const CATEGORY_LABELS: Record<string, string> = {
  debugging: 'DEBUGGING',
  styling: 'STYLING',
  'explain-again': 'EXPLAIN AGAIN',
  refactoring: 'REFACTOR',
  testing: 'TESTING',
  'new-code': 'NEW CODE',
  opinion: 'OPINION POLL',
  typo: 'TYPO FIX',
  misc: 'MISC',
};

const MIN_DOT_PADDING = 2;

function formatDollars(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function dots(n: number): string {
  return '.'.repeat(Math.max(2, n));
}

function centerLine(text: string, width: number): string {
  if (text.length >= width) return text;
  const pad = Math.floor((width - text.length) / 2);
  return ' '.repeat(pad) + text;
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return text.slice(0, width - 1) + '…';
}

export function renderReceiptTerminal(receipt: Receipt, width: number = 64): string {
  const w = Math.max(40, width);
  const lines: string[] = [];
  const divider = '-'.repeat(w);
  const dottedDivider = '- '.repeat(Math.floor(w / 2));

  lines.push(centerLine('TOKENLEAK', w));
  lines.push(centerLine('ITEMIZED RECEIPT', w));
  lines.push(centerLine(`${receipt.summary.dateRange.since} — ${receipt.summary.dateRange.until}`, w));
  lines.push(dottedDivider);

  if (receipt.lines.length === 0) {
    lines.push('');
    lines.push(centerLine('No itemized prompts captured in this period.', w));
    lines.push('');
  } else {
    for (const line of receipt.lines) {
      lines.push(...renderLineItem(line, w));
    }
  }

  lines.push(dottedDivider);
  lines.push(totalRow('SUBTOTAL', formatDollars(receipt.summary.subtotal), w));
  lines.push(
    totalRow(
      `SERVICE FEES (${receipt.summary.unlabeledEvents} uncaptured)`,
      formatDollars(receipt.summary.serviceFees),
      w,
    ),
  );
  lines.push(divider);
  lines.push(totalRow('TOTAL', formatDollars(receipt.summary.total), w));
  lines.push('');
  lines.push(centerLine('THANK YOU FOR YOUR PATRONAGE', w));
  lines.push(centerLine(`tokenleak · ${new Date().toISOString().slice(0, 10)}`, w));

  return lines.join('\n');
}

function renderLineItem(line: ReceiptLine, width: number): string[] {
  const category = CATEGORY_LABELS[line.category] ?? line.category.toUpperCase();
  const qtyStr = `${line.quantity}×`;
  const costStr = formatDollars(line.totalCost);

  const descriptionSpace = width - costStr.length - MIN_DOT_PADDING;
  const description = truncate(`${qtyStr} ${line.description}`, descriptionSpace);
  const padding = dots(width - description.length - costStr.length);

  return [
    `[${category}]`,
    `${description}${padding}${costStr}`,
    '',
  ];
}

function totalRow(label: string, value: string, width: number): string {
  const available = width - label.length - value.length;
  const spacer = ' '.repeat(Math.max(1, available));
  return `${label}${spacer}${value}`;
}

/**
 * Collects all events with prompts across providers for receipt generation.
 * Exported so MCP + CLI + TUI share the extraction logic.
 */
export function collectEventsForReceipt(providers: { events?: UsageEvent[] }[]): UsageEvent[] {
  const all: UsageEvent[] = [];
  for (const provider of providers) {
    if (provider.events) all.push(...provider.events);
  }
  return all;
}

export function buildReceiptsHelpText(): string {
  return [
    'Usage:',
    '  tokenleak receipts [flags]',
    '',
    'Receipts Flags:',
    '  -f, --format <format>   Output format: terminal (default), svg, png, json',
    '  -o, --output <path>     Write output to a file and infer format from extension',
    '  -s, --since <date>      Start date (YYYY-MM-DD)',
    '  -u, --until <date>      End date (YYYY-MM-DD), defaults to today',
    '  -d, --days <n>          Number of days to look back (default: 30)',
    '  -t, --theme <theme>     Color theme for svg/png output: dark (default), light',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --claude            Only include Claude Code',
    '      --codex             Only include Codex',
    '      --cursor            Only include Cursor',
    '      --pi                Only include Pi',
    '      --open-code         Only include OpenCode',
    '      --all-providers     Ignore provider filters and use every available provider',
    '      --top <n>           Show top N line items (default: 12)',
    '      --no-color          Accepted for parity with terminal output',
    '      --help              Show receipts help',
    '',
    'Note: prompt capture currently only works for Claude Code logs.',
    '',
    'Examples:',
    '  tokenleak receipts',
    '  tokenleak receipts --since 2026-04-01 --until 2026-04-30',
    '  tokenleak receipts --output receipt.png',
    '  tokenleak receipts --format json',
    '',
  ].join('\n');
}
