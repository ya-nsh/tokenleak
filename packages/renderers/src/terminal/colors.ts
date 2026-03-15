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
 * Wrap text with a 256-color ANSI background code.
 * When noColor is true, returns the text unmodified.
 */
export function background256(text: string, code: number, noColor: boolean): string {
  if (noColor) return text;
  return `${ESC}48;5;${code}m${text}${RESET}`;
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

/** Semantic color constants for dashboard UI elements. */
export const SEMANTIC = {
  INPUT: 68,     // steel blue
  OUTPUT: 71,    // sage green
  ACCENT: 173,   // terracotta
  NEGATIVE: 167, // brick red
  ACTIVE: 68,    // steel blue (active tab)
  HINT: 179,     // warm amber (keyboard hints)
} as const;

/** Day-of-week colors (7 distinct 256-color codes). */
export const DOW_COLORS: Record<string, number> = {
  Sun: 174, // soft coral
  Mon: 68,  // steel blue
  Tue: 71,  // sage green
  Wed: 179, // warm amber
  Thu: 140, // soft lavender
  Fri: 115, // mint/seafoam
  Sat: 173, // terracotta
};

/** Time-of-day bucket colors (5 distinct 256-color codes). */
export const TOD_COLORS: Record<string, number> = {
  'After midnight': 140, // soft lavender
  Morning: 179,          // warm amber
  Afternoon: 71,         // sage green
  Evening: 68,           // steel blue
  Night: 96,             // dusty purple
};

/** Distinct colors for up to 10 models. */
export const MODEL_COLORS: number[] = [
  68,  // steel blue
  71,  // sage green
  173, // terracotta
  140, // soft lavender
  179, // warm amber
  174, // soft coral
  139, // mauve pink
  73,  // muted teal
  167, // brick red
  115, // mint/seafoam
];

/** Distinct colors for up to 10 projects. */
export const PROJECT_COLORS: number[] = [
  71,  // sage green
  68,  // steel blue
  173, // terracotta
  139, // mauve pink
  179, // warm amber
  140, // soft lavender
  174, // soft coral
  73,  // muted teal
  167, // brick red
  115, // mint/seafoam
];
