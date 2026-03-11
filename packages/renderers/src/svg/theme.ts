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
  heatmap: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
  accent: '#58a6ff',
  accentSecondary: '#bc8cff',
  barFill: '#58a6ff',
  barBackground: '#21262d',
};

export const LIGHT_THEME: SvgTheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  muted: '#656d76',
  border: '#d0d7de',
  cardBackground: '#f6f8fa',
  heatmap: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
  accent: '#0969da',
  accentSecondary: '#8250df',
  barFill: '#0969da',
  barBackground: '#eaeef2',
};

export function getTheme(mode: 'dark' | 'light'): SvgTheme {
  return mode === 'dark' ? DARK_THEME : LIGHT_THEME;
}
