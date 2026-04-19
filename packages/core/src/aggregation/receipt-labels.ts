import type { ReceiptCategory } from './receipt-lines';

/**
 * Long-form labels for receipt line categories. Used by the CLI terminal
 * renderer and the SVG renderer so every surface agrees on the display
 * string for a given category value.
 */
export const CATEGORY_LABELS: Record<ReceiptCategory, string> = {
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

/**
 * Short-form labels for constrained surfaces (e.g. the TUI receipts panel
 * where horizontal space is tight).
 */
export const CATEGORY_LABELS_SHORT: Record<ReceiptCategory, string> = {
  debugging: 'DEBUG',
  styling: 'STYLE',
  'explain-again': 'EXPLAIN',
  refactoring: 'REFACTOR',
  testing: 'TEST',
  'new-code': 'NEW CODE',
  opinion: 'OPINION',
  typo: 'TYPO',
  misc: 'MISC',
};

/**
 * Always render receipt amounts with two decimal places so every surface
 * agrees on cent-priced display.
 */
export function formatReceiptDollars(cost: number): string {
  return `$${cost.toFixed(2)}`;
}
