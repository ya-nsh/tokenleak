import { createTextAttributes } from '@opentui/core';

/** Bloomberg-style color palette */
export const COLORS = {
  bg: '#0a0a0a',
  bgPanel: '#111111',
  green: '#00ff00',
  amber: '#ffb900',
  cyan: '#00bcd4',
  red: '#ff4444',
  white: '#e0e0e0',
  dimWhite: '#888888',
  magenta: '#ff66ff',
  blue: '#4488ff',
} as const;

/** Pre-computed text attributes */
export const BOLD = createTextAttributes({ bold: true });

/** Provider brand colors for the providers panel */
export const PROVIDER_COLORS: Record<string, string> = {
  'claude-code': '#d97706',
  codex: '#22c55e',
  cursor: '#8b5cf6',
  pi: '#06b6d4',
  'open-code': '#ef4444',
};

/** Model colors for chart segments (8 distinct colors) */
export const MODEL_COLORS = [
  '#ffb900', // amber
  '#00bcd4', // cyan
  '#ff66ff', // magenta
  '#4488ff', // blue
  '#00ff00', // green
  '#ff4444', // red
  '#22c55e', // emerald
  '#8b5cf6', // purple
] as const;

/** Pre-computed dim text attributes */
export const DIM = createTextAttributes({ dim: true });

/** Cycle colors for providers without a known brand color */
const CYCLE_COLORS = [
  COLORS.green,
  COLORS.cyan,
  COLORS.amber,
  COLORS.magenta,
  COLORS.blue,
] as const;

export function getProviderColor(providerName: string, index: number): string {
  return PROVIDER_COLORS[providerName] ?? CYCLE_COLORS[index % CYCLE_COLORS.length] ?? COLORS.green;
}
