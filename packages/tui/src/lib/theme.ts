import { RGBA, createTextAttributes } from '@opentui/core';

/**
 * The palette every view draws with. Muted, high-contrast tones on a deep
 * neutral background; the names describe roles in the original palette
 * (green for volume, amber for money, red for warnings).
 */
export const COLORS = {
  bg: '#0d1117',
  bgPanel: '#161b22',
  green: '#3fb950',
  amber: '#e3b341',
  cyan: '#39c5cf',
  red: '#f85149',
  white: '#e6edf3',
  dimWhite: '#7d8590',
  magenta: '#d2a8ff',
  blue: '#58a6ff',
  /** Panel borders and rules that should recede. */
  border: '#30363d',
  /** Folded "everything else" series in charts. */
  muted: '#484f58',
} as const;

/** Pre-computed text attributes */
export const BOLD = createTextAttributes({ bold: true });

/** Provider brand colors for the providers panel */
export const PROVIDER_COLORS: Record<string, string> = {
  'claude-code': '#d97706',
  codex: '#22c55e',
  cursor: '#8b5cf6',
  gemini: '#4285f4',
  copilot: '#6e7781',
  amp: '#ff5a1f',
  codebuff: '#2563eb',
  droid: '#f97316',
  qwen: '#7c3aed',
  'roo-code': '#0f766e',
  'kilo-code': '#2563eb',
  kimi: '#111827',
  kilo: '#f59e0b',
  mux: '#ec4899',
  crush: '#ef4444',
  openclaw: '#dc2626',
  hermes: '#16a34a',
  goose: '#0f766e',
  antigravity: '#7c3aed',
  zed: '#0891b2',
  kiro: '#6366f1',
  trae: '#06b6d4',
  synthetic: '#10b981',
  pi: '#06b6d4',
  'open-code': '#ef4444',
};

/** Model colors for chart segments (8 distinct colors) */
export const MODEL_COLORS = [
  '#e3b341', // amber
  '#39c5cf', // cyan
  '#d2a8ff', // lavender
  '#58a6ff', // blue
  '#3fb950', // green
  '#f78166', // coral
  '#56d364', // mint
  '#a371f7', // purple
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

const rgbaCache = new Map<string, RGBA>();

/** A shared RGBA for a hex colour, for styled text built every frame. */
export function rgba(hex: string): RGBA {
  let color = rgbaCache.get(hex);
  if (!color) {
    color = RGBA.fromHex(hex);
    rgbaCache.set(hex, color);
  }
  return color;
}
