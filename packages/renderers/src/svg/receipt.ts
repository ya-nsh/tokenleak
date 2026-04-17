import type { Receipt } from '@tokenleak/core';
import { escapeXml } from './utils';

const WIDTH = 800;
const PAD_X = 48;
const HEADER_HEIGHT = 180;
const LINE_HEIGHT = 52;
const SECTION_GAP = 24;
const FOOTER_HEIGHT = 120;
const TEAR_TEETH = 40;

const MONO = "'JetBrains Mono', 'SF Mono', 'Menlo', 'Consolas', monospace";
const DISPLAY = "'Bricolage Grotesque', 'SF Pro Display', 'Helvetica Neue', sans-serif";

interface ReceiptTheme {
  paper: string;
  ink: string;
  inkDim: string;
  rule: string;
  accent: string;
}

const DARK: ReceiptTheme = {
  paper: '#14120e',
  ink: '#f4efde',
  inkDim: 'rgba(244,239,222,0.55)',
  rule: 'rgba(244,239,222,0.2)',
  accent: '#d4af5f',
};

const LIGHT: ReceiptTheme = {
  paper: '#f7f2e4',
  ink: '#1a1612',
  inkDim: 'rgba(26,22,18,0.55)',
  rule: 'rgba(26,22,18,0.22)',
  accent: '#8a6b2f',
};

const CATEGORY_LABELS: Record<string, string> = {
  debugging: 'DEBUGGING',
  styling: 'STYLING',
  explaining: 'EXPLAIN AGAIN',
  refactoring: 'REFACTOR',
  testing: 'TESTING',
  'writing-code': 'NEW CODE',
  opinion: 'OPINION POLL',
  typo: 'TYPO FIX',
  misc: 'MISC',
};

function formatDollars(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 10) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(cost >= 1 ? 2 : 3)}`;
}

function formatDate(iso: string): string {
  return iso;
}

function tearEdge(y: number, theme: ReceiptTheme, flip: boolean): string {
  const teeth = TEAR_TEETH;
  const toothWidth = WIDTH / teeth;
  const toothHeight = 12;
  const direction = flip ? -1 : 1;
  const points: string[] = [];
  points.push(`0,${y}`);
  for (let i = 0; i < teeth; i++) {
    const xStart = i * toothWidth;
    const xMid = xStart + toothWidth / 2;
    const xEnd = xStart + toothWidth;
    const yTooth = y + direction * toothHeight;
    points.push(`${xMid},${yTooth}`);
    points.push(`${xEnd},${y}`);
  }
  return `<polyline points="${points.join(' ')}" fill="none" stroke="${theme.rule}" stroke-width="1.5"/>`;
}

/**
 * Render a "tokenleak receipt" — a thermal-receipt-style SVG itemizing AI coding
 * spend by prompt cluster. Output dimensions are 800px wide with dynamic height.
 */
export function renderReceiptSvg(
  receipt: Receipt,
  options: { theme?: 'dark' | 'light' } = {},
): string {
  const theme = options.theme === 'light' ? LIGHT : DARK;

  const linesHeight = receipt.lines.length * LINE_HEIGHT + SECTION_GAP * 2;
  const totalsHeight = 180;
  const height =
    HEADER_HEIGHT + linesHeight + totalsHeight + FOOTER_HEIGHT;

  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}">`,
  );
  parts.push(
    `<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${theme.paper}"/>`,
  );

  // ── Tear-off top edge ────────────────────────────────────────────
  parts.push(tearEdge(24, theme, true));

  // ── Header ───────────────────────────────────────────────────────
  let y = 80;
  parts.push(
    `<text x="${WIDTH / 2}" y="${y}" font-family="${DISPLAY}" font-size="34" font-weight="700" fill="${theme.ink}" text-anchor="middle" letter-spacing="4">TOKENLEAK</text>`,
  );
  y += 34;
  parts.push(
    `<text x="${WIDTH / 2}" y="${y}" font-family="${MONO}" font-size="13" fill="${theme.inkDim}" text-anchor="middle" letter-spacing="3">ITEMIZED RECEIPT</text>`,
  );
  y += 30;
  parts.push(
    `<text x="${WIDTH / 2}" y="${y}" font-family="${MONO}" font-size="12" fill="${theme.inkDim}" text-anchor="middle">${escapeXml(formatDate(receipt.summary.dateRange.since))} — ${escapeXml(formatDate(receipt.summary.dateRange.until))}</text>`,
  );

  y = HEADER_HEIGHT;
  parts.push(dottedRule(y, theme));
  y += SECTION_GAP;

  // ── Line items ───────────────────────────────────────────────────
  if (receipt.lines.length === 0) {
    parts.push(
      `<text x="${WIDTH / 2}" y="${y + 40}" font-family="${MONO}" font-size="14" fill="${theme.inkDim}" text-anchor="middle">No itemized prompts captured in this period.</text>`,
    );
    y += 80;
  } else {
    for (const line of receipt.lines) {
      parts.push(lineItemRow(line, y, theme));
      y += LINE_HEIGHT;
    }
  }

  y += SECTION_GAP;
  parts.push(dottedRule(y, theme));
  y += SECTION_GAP;

  // ── Totals ───────────────────────────────────────────────────────
  parts.push(totalRow('SUBTOTAL', formatDollars(receipt.summary.subtotal), y, theme, false));
  y += 36;
  parts.push(
    totalRow(
      `SERVICE FEES  (${receipt.summary.unlabeledEvents} uncaptured)`,
      formatDollars(receipt.summary.serviceFees),
      y,
      theme,
      false,
    ),
  );
  y += 36;
  parts.push(dottedRule(y, theme));
  y += 28;
  parts.push(totalRow('TOTAL', formatDollars(receipt.summary.total), y, theme, true));
  y += 48;

  // ── Footer ───────────────────────────────────────────────────────
  parts.push(
    `<text x="${WIDTH / 2}" y="${y + 20}" font-family="${MONO}" font-size="11" fill="${theme.inkDim}" text-anchor="middle" letter-spacing="2">THANK YOU FOR YOUR PATRONAGE</text>`,
  );
  parts.push(
    `<text x="${WIDTH / 2}" y="${y + 48}" font-family="${MONO}" font-size="10" fill="${theme.inkDim}" text-anchor="middle">tokenleak · generated ${escapeXml(new Date().toISOString().slice(0, 10))}</text>`,
  );

  // ── Tear-off bottom edge ─────────────────────────────────────────
  parts.push(tearEdge(height - 24, theme, false));

  parts.push('</svg>');
  return parts.join('');
}

function dottedRule(y: number, theme: ReceiptTheme): string {
  return `<line x1="${PAD_X}" y1="${y}" x2="${WIDTH - PAD_X}" y2="${y}" stroke="${theme.rule}" stroke-width="1.5" stroke-dasharray="2,4"/>`;
}

function lineItemRow(
  line: { description: string; category: string; quantity: number; totalCost: number },
  y: number,
  theme: ReceiptTheme,
): string {
  const categoryLabel = CATEGORY_LABELS[line.category] ?? line.category.toUpperCase();
  const qtyStr = `${line.quantity}×`;
  const costStr = formatDollars(line.totalCost);
  const leftX = PAD_X;
  const rightX = WIDTH - PAD_X;

  const label =
    `<text x="${leftX}" y="${y}" font-family="${MONO}" font-size="10" fill="${theme.accent}" letter-spacing="2">${escapeXml(categoryLabel)}</text>` +
    `<text x="${leftX}" y="${y + 20}" font-family="${MONO}" font-size="14" fill="${theme.ink}">${escapeXml(line.description)}</text>` +
    `<text x="${leftX}" y="${y + 38}" font-family="${MONO}" font-size="11" fill="${theme.inkDim}">${escapeXml(qtyStr)}</text>`;

  const cost = `<text x="${rightX}" y="${y + 20}" font-family="${MONO}" font-size="16" font-weight="600" fill="${theme.ink}" text-anchor="end">${escapeXml(costStr)}</text>`;

  return label + cost;
}

function totalRow(
  label: string,
  value: string,
  y: number,
  theme: ReceiptTheme,
  emphatic: boolean,
): string {
  const size = emphatic ? 22 : 13;
  const weight = emphatic ? 700 : 500;
  const color = emphatic ? theme.accent : theme.ink;
  return (
    `<text x="${PAD_X}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" fill="${color}" letter-spacing="${emphatic ? 3 : 1}">${escapeXml(label)}</text>` +
    `<text x="${WIDTH - PAD_X}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="end">${escapeXml(value)}</text>`
  );
}
