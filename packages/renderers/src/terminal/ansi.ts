const ESC = '\x1b[';

const CODES = {
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  red: `${ESC}31m`,
  cyan: `${ESC}36m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  reset: `${ESC}0m`,
} as const;

export type AnsiColor = keyof typeof CODES;

export function colorize(text: string, color: AnsiColor, noColor: boolean): string {
  if (noColor) {
    return text;
  }
  return `${CODES[color]}${text}${CODES.reset}`;
}

/** Heatmap intensity blocks from highest to lowest. */
export const HEATMAP_BLOCKS = {
  FULL: '\u2588',   // █
  DARK: '\u2593',   // ▓
  MEDIUM: '\u2592', // ▒
  LIGHT: '\u2591',  // ░
  EMPTY: ' ',
} as const;

/**
 * Returns a heatmap block character based on the ratio (0..1) of value to max.
 */
export function intensityBlock(value: number, max: number): string {
  if (max <= 0 || value <= 0) return HEATMAP_BLOCKS.EMPTY;
  const ratio = value / max;
  if (ratio >= 0.75) return HEATMAP_BLOCKS.FULL;
  if (ratio >= 0.50) return HEATMAP_BLOCKS.DARK;
  if (ratio >= 0.25) return HEATMAP_BLOCKS.MEDIUM;
  return HEATMAP_BLOCKS.LIGHT;
}

export function intensityColor(value: number, max: number): AnsiColor {
  if (max <= 0 || value <= 0) return 'dim';
  const ratio = value / max;
  if (ratio >= 0.75) return 'green';
  if (ratio >= 0.50) return 'yellow';
  if (ratio >= 0.25) return 'cyan';
  return 'dim';
}
