const ESC = '\x1b[';
const RESET = `${ESC}0m`;

/**
 * Wrap text with a 256-color ANSI foreground code.
 * When noColor is true, returns the text unmodified.
 */
export function colorize256(text: string, code: number, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}38;5;${code}m${text}${RESET}`;
}

/**
 * Wrap text with bold + 256-color ANSI foreground.
 */
export function bold256(text: string, code: number, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}1;38;5;${code}m${text}${RESET}`;
}

/**
 * Wrap text with inverse (highlighted) styling using a 256-color.
 */
export function inverse256(text: string, code: number, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}7;38;5;${code}m${text}${RESET}`;
}

/**
 * Wrap text with dim styling.
 */
export function dim(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}2m${text}${RESET}`;
}

/**
 * Wrap text with bold styling.
 */
export function bold(text: string, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}1m${text}${RESET}`;
}

/** Day-of-week colors (7 distinct 256-color codes). */
export const DOW_COLORS: Record<string, number> = {
  Sun: 213, // pink
  Mon: 33,  // blue
  Tue: 40,  // green
  Wed: 208, // orange
  Thu: 141, // purple
  Fri: 220, // gold
  Sat: 209, // coral
};

/** Time-of-day bucket colors (5 distinct 256-color codes). */
export const TOD_COLORS: Record<string, number> = {
  'After midnight': 213, // pink
  Morning: 208,          // orange
  Afternoon: 40,         // green
  Evening: 33,           // blue
  Night: 141,            // purple
};

/** Distinct colors for up to 10 models. */
export const MODEL_COLORS: number[] = [
  33,  // blue
  40,  // green
  208, // orange
  141, // purple
  220, // gold
  209, // coral
  213, // pink
  51,  // cyan
  196, // red
  118, // lime
];

/** Distinct colors for up to 10 projects. */
export const PROJECT_COLORS: number[] = [
  40,  // green
  33,  // blue
  208, // orange
  213, // pink
  220, // gold
  141, // purple
  209, // coral
  51,  // cyan
  196, // red
  118, // lime
];
