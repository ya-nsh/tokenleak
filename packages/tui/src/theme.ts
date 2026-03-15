import { SEMANTIC } from '@tokenleak/renderers';

/** Map SEMANTIC 256-color codes to hex colors for OpenTUI style props. */
function ansi256ToHex(code: number): string {
  // Standard 256-color ANSI palette (color cube + grayscale)
  if (code < 16) {
    const standard: string[] = [
      '#000000', '#800000', '#008000', '#808000',
      '#000080', '#800080', '#008080', '#c0c0c0',
      '#808080', '#ff0000', '#00ff00', '#ffff00',
      '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
    ];
    return standard[code] ?? '#ffffff';
  }

  if (code < 232) {
    const index = code - 16;
    const r = Math.floor(index / 36);
    const g = Math.floor((index % 36) / 6);
    const b = index % 6;
    const toHex = (v: number): string => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  const gray = 8 + (code - 232) * 10;
  const hex = gray.toString(16).padStart(2, '0');
  return `#${hex}${hex}${hex}`;
}

export const THEME = {
  INPUT: ansi256ToHex(SEMANTIC.INPUT),
  OUTPUT: ansi256ToHex(SEMANTIC.OUTPUT),
  ACCENT: ansi256ToHex(SEMANTIC.ACCENT),
  NEGATIVE: ansi256ToHex(SEMANTIC.NEGATIVE),
  ACTIVE: ansi256ToHex(SEMANTIC.ACTIVE),
  HINT: ansi256ToHex(SEMANTIC.HINT),

  BG: '#1a1a2e',
  FG: '#e0e0e0',
  DIM: '#666666',
  BOLD_FG: '#ffffff',
  SUCCESS: '#00cc66',
  ERROR: '#cc3333',
  WARNING: '#ccaa00',
  CYAN: '#00cccc',
} as const;

/** Named theme variants for the theme picker. */
export type ThemeVariant =
  | 'green' | 'teal' | 'blue' | 'pink' | 'purple'
  | 'orange' | 'halloween' | 'monochrome' | 'ylgnbu';

export interface ThemePalette {
  name: string;
  accent: string;
  active: string;
  /** 5-grade activity colors for heatmaps/contribution graphs (least → most). */
  grades: [string, string, string, string, string];
}

export const THEME_VARIANTS: Record<ThemeVariant, ThemePalette> = {
  green: {
    name: 'Green',
    accent: '#00cc66',
    active: '#00cc66',
    grades: ['#0e4429', '#006d32', '#26a641', '#39d353', '#6bff6b'],
  },
  teal: {
    name: 'Teal',
    accent: '#2dd4bf',
    active: '#2dd4bf',
    grades: ['#134e4a', '#0f766e', '#14b8a6', '#2dd4bf', '#5eead4'],
  },
  blue: {
    name: 'Blue',
    accent: '#3b82f6',
    active: '#3b82f6',
    grades: ['#1e3a5f', '#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd'],
  },
  pink: {
    name: 'Pink',
    accent: '#ec4899',
    active: '#ec4899',
    grades: ['#831843', '#be185d', '#ec4899', '#f472b6', '#f9a8d4'],
  },
  purple: {
    name: 'Purple',
    accent: '#a855f7',
    active: '#a855f7',
    grades: ['#3b0764', '#7e22ce', '#a855f7', '#c084fc', '#d8b4fe'],
  },
  orange: {
    name: 'Orange',
    accent: '#f97316',
    active: '#f97316',
    grades: ['#7c2d12', '#c2410c', '#f97316', '#fb923c', '#fdba74'],
  },
  halloween: {
    name: 'Halloween',
    accent: '#ff6600',
    active: '#ff6600',
    grades: ['#161b22', '#631c03', '#bd561d', '#fa7a18', '#fddf68'],
  },
  monochrome: {
    name: 'Monochrome',
    accent: '#d4d4d4',
    active: '#a3a3a3',
    grades: ['#262626', '#404040', '#737373', '#a3a3a3', '#d4d4d4'],
  },
  ylgnbu: {
    name: 'YlGnBu',
    accent: '#41b6c4',
    active: '#41b6c4',
    grades: ['#253494', '#2c7fb8', '#41b6c4', '#7fcdbb', '#c7e9b4'],
  },
};
