export interface SvgTheme {
  background: string;
  foreground: string;
  muted: string;
  border: string;
  cardBackground: string;
  heatmap: [string, string, string, string, string]; // empty, low, medium, high, extreme
  accent: string;
  accentSecondary: string;
  barFill: string;
  barBackground: string;
}

export const DARK_THEME: SvgTheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  muted: '#7d8590',
  border: '#30363d',
  cardBackground: '#161b22',
  heatmap: ['#161b22', '#1e3a5f', '#2563eb', '#3b82f6', '#1d4ed8'],
  accent: '#58a6ff',
  accentSecondary: '#bc8cff',
  barFill: '#3b82f6',
  barBackground: '#21262d',
};

export const LIGHT_THEME: SvgTheme = {
  background: '#ffffff',
  foreground: '#1a1a2e',
  muted: '#8b8fa3',
  border: '#e5e7eb',
  cardBackground: '#f8f9fc',
  heatmap: ['#ebedf0', '#c6d4f7', '#8da4ef', '#5b6abf', '#2f3778'],
  accent: '#3b5bdb',
  accentSecondary: '#7048e8',
  barFill: '#5b6abf',
  barBackground: '#ebedf0',
};

export function getTheme(mode: 'dark' | 'light'): SvgTheme {
  return mode === 'dark' ? DARK_THEME : LIGHT_THEME;
}
