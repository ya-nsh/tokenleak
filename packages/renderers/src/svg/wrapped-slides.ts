import type { TokenleakOutput } from '@tokenleak/core';
import { escapeXml, formatNumber, formatCost } from './utils';
import { getTheme } from './theme';
import type { SvgTheme } from './theme';

// ── Constants ────────────────────────────────────────────────────────
const WIDTH = 1200;
const PAD = 80;
const DISPLAY_FONT =
  "'SF Pro Display', 'Helvetica Neue', 'Segoe UI', -apple-system, sans-serif";
const MONO_FONT =
  "'SF Mono', 'Menlo', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace";
const BODY_FONT =
  "'SF Pro Text', 'Helvetica Neue', 'Segoe UI', -apple-system, sans-serif";

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Theme ────────────────────────────────────────────────────────────
interface WrappedTheme {
  base: SvgTheme;
  mode: 'dark' | 'light';
  sectionBgs: Array<[string, string]>;
  heroAccent: string;
  warmAccent: string;
  coolAccent: string;
  greenAccent: string;
  goldAccent: string;
  purpleAccent: string;
  narrativeColor: string;
  subtitleColor: string;
}

function getWrappedTheme(mode: 'dark' | 'light'): WrappedTheme {
  const base = getTheme(mode);
  if (mode === 'dark') {
    return {
      base,
      mode,
      sectionBgs: [
        ['#08080c', '#0c0c14'],  // title — near black
        ['#0a0a12', '#0e0e18'],  // big numbers
        ['#0c0a08', '#100e0c'],  // streak — warm black
        ['#080c14', '#0c1018'],  // model — cool black
        ['#0a0a0e', '#0e0e12'],  // provider
        ['#080c14', '#0c1018'],  // day of week
        ['#0c0814', '#100c18'],  // time of day
        ['#080e0c', '#0c1210'],  // cache
        ['#0c0a06', '#100e0a'],  // peak day
        ['#08080c', '#0c0c14'],  // achievements
        ['#0a0c10', '#0e1014'],  // projection
        ['#060608', '#060608'],  // footer
      ],
      heroAccent: '#a78bfa',
      warmAccent: '#fb923c',
      coolAccent: '#38bdf8',
      greenAccent: '#4ade80',
      goldAccent: '#fbbf24',
      purpleAccent: '#c084fc',
      narrativeColor: '#d1d5db',
      subtitleColor: '#6b7280',
    };
  }
  return {
    base,
    mode,
    sectionBgs: [
      ['#fafaf9', '#f5f5f4'],
      ['#f5f5f4', '#fafaf9'],
      ['#fefce8', '#fef9c3'],
      ['#eff6ff', '#dbeafe'],
      ['#fafaf9', '#f5f5f4'],
      ['#eff6ff', '#dbeafe'],
      ['#faf5ff', '#f3e8ff'],
      ['#ecfdf5', '#d1fae5'],
      ['#fffbeb', '#fef3c7'],
      ['#faf5ff', '#f3e8ff'],
      ['#eff6ff', '#dbeafe'],
      ['#fafaf9', '#fafaf9'],
    ],
    heroAccent: '#7c3aed',
    warmAccent: '#ea580c',
    coolAccent: '#2563eb',
    greenAccent: '#16a34a',
    goldAccent: '#ca8a04',
    purpleAccent: '#7c3aed',
    narrativeColor: '#1f2937',
    subtitleColor: '#6b7280',
  };
}

// ── Section result type ──────────────────────────────────────────────
interface SlideResult {
  svg: string;
  height: number;
}

// ── SVG icon shapes ──────────────────────────────────────────────────
function svgIconFire(x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})">` +
    `<path d="M12 2C6 8 4 12 4 15.5C4 19.09 7.58 22 12 22C16.42 22 20 19.09 20 15.5C20 12 18 8 12 2Z" ` +
    `fill="${escapeXml(color)}" opacity="0.85"/>` +
    `<path d="M12 8C9 12 8 14 8 15.5C8 17.71 9.79 19.5 12 19.5C14.21 19.5 16 17.71 16 15.5C16 14 15 12 12 8Z" ` +
    `fill="${escapeXml(color)}" opacity="0.5"/>` +
    `</g>`;
}

function svgIconStar(x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})">` +
    `<path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" ` +
    `fill="${escapeXml(color)}" opacity="0.85"/>` +
    `</g>`;
}

function svgIconCircle(x: number, y: number, size: number, color: string): string {
  const r = size / 2;
  return `<circle cx="${x + r}" cy="${y + r}" r="${r}" fill="${escapeXml(color)}" opacity="0.85"/>`;
}

function svgIconDiamond(x: number, y: number, size: number, color: string): string {
  const s = size / 2;
  const cx = x + s;
  const cy = y + s;
  return `<path d="M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z" ` +
    `fill="${escapeXml(color)}" opacity="0.85"/>`;
}

function svgIconBolt(x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})">` +
    `<path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" fill="${escapeXml(color)}" opacity="0.85"/>` +
    `</g>`;
}

function svgIconTrophy(x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})">` +
    `<path d="M7 4V2H17V4H20V8C20 9.1 19.1 10 18 10H16.76C16.34 11.8 14.84 13.17 13 13.44V16H16V18H8V16H11V13.44C9.16 13.17 7.66 11.8 7.24 10H6C4.9 10 4 9.1 4 8V4H7Z" ` +
    `fill="${escapeXml(color)}" opacity="0.85"/>` +
    `</g>`;
}

function svgIconTarget(x: number, y: number, size: number, color: string): string {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size / 2;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${escapeXml(color)}" stroke-width="2" opacity="0.6"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.6}" fill="none" stroke="${escapeXml(color)}" stroke-width="2" opacity="0.7"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.25}" fill="${escapeXml(color)}" opacity="0.85"/>`;
}

function svgIconMountain(x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})">` +
    `<path d="M14 6L20 18H4L10 8L13 12.5L14 6Z" fill="${escapeXml(color)}" opacity="0.85"/>` +
    `</g>`;
}

function svgIconPalette(x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})">` +
    `<path d="M12 2C6.49 2 2 6.49 2 12C2 17.51 6.49 22 12 22C12.83 22 13.5 21.33 13.5 20.5C13.5 20.12 13.37 19.78 13.15 19.52C12.93 19.26 12.82 18.93 12.82 18.57C12.82 17.75 13.5 17.07 14.32 17.07H16.5C19.54 17.07 22 14.61 22 11.57C22 6.28 17.51 2 12 2Z" ` +
    `fill="${escapeXml(color)}" opacity="0.85"/>` +
    `</g>`;
}

function svgIconCalendar(x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})">` +
    `<path d="M19 4H18V2H16V4H8V2H6V4H5C3.89 4 3 4.9 3 6V20C3 21.1 3.89 22 5 22H19C20.1 22 21 21.1 21 20V6C21 4.9 20.1 4 19 4ZM19 20H5V10H19V20ZM19 8H5V6H19V8Z" ` +
    `fill="${escapeXml(color)}" opacity="0.85"/>` +
    `</g>`;
}

function svgIconMoon(x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})">` +
    `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="${escapeXml(color)}" opacity="0.85"/>` +
    `</g>`;
}

function svgIconSun(x: number, y: number, size: number, color: string): string {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.3;
  let svg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${escapeXml(color)}" opacity="0.85"/>`;
  for (let i = 0; i < 8; i++) {
    const angle = (i * 45 * Math.PI) / 180;
    const x1 = cx + r * 1.4 * Math.cos(angle);
    const y1 = cy + r * 1.4 * Math.sin(angle);
    const x2 = cx + r * 2 * Math.cos(angle);
    const y2 = cy + r * 2 * Math.sin(angle);
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeXml(color)}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`;
  }
  return svg;
}

function svgIconRocket(x: number, y: number, size: number, color: string): string {
  const s = size / 24;
  return `<g transform="translate(${x},${y}) scale(${s})">` +
    `<path d="M12 2.5C12 2.5 7 8 7 13.5C7 16.81 9.24 19.5 12 19.5C14.76 19.5 17 16.81 17 13.5C17 8 12 2.5 12 2.5Z" ` +
    `fill="${escapeXml(color)}" opacity="0.85"/>` +
    `<circle cx="12" cy="13" r="2" fill="${escapeXml(color)}" opacity="0.4"/>` +
    `</g>`;
}

type IconName = 'fire' | 'star' | 'circle' | 'diamond' | 'bolt' | 'trophy' |
  'target' | 'mountain' | 'palette' | 'calendar' | 'moon' | 'sun' | 'rocket';

function renderIcon(name: IconName, x: number, y: number, size: number, color: string): string {
  const fns: Record<IconName, (x: number, y: number, s: number, c: string) => string> = {
    fire: svgIconFire, star: svgIconStar, circle: svgIconCircle,
    diamond: svgIconDiamond, bolt: svgIconBolt, trophy: svgIconTrophy,
    target: svgIconTarget, mountain: svgIconMountain, palette: svgIconPalette,
    calendar: svgIconCalendar, moon: svgIconMoon, sun: svgIconSun, rocket: svgIconRocket,
  };
  return fns[name](x, y, size, color);
}

// ── Achievements ─────────────────────────────────────────────────────
export interface Achievement {
  icon: IconName;
  title: string;
  subtitle: string;
  color: string;
}

export function computeAchievements(output: TokenleakOutput): Achievement[] {
  const stats = output.aggregated;
  const more = output.more;
  const providers = output.providers;
  const all: Achievement[] = [];

  if (stats.longestStreak > 30) {
    all.push({ icon: 'fire', title: 'Streak Master', subtitle: `${stats.longestStreak} day streak`, color: '#f59e0b' });
  }
  if (more?.hourOfDay) {
    const totalTokens = more.hourOfDay.reduce((s, e) => s + e.tokens, 0);
    const nightTokens = more.hourOfDay.filter((e) => e.hour >= 22 || e.hour < 6).reduce((s, e) => s + e.tokens, 0);
    if (totalTokens > 0 && nightTokens / totalTokens > 0.4) {
      all.push({ icon: 'moon', title: 'Night Owl', subtitle: `${((nightTokens / totalTokens) * 100).toFixed(0)}% between 10pm-6am`, color: '#818cf8' });
    }
  }
  if (more?.hourOfDay) {
    const totalTokens = more.hourOfDay.reduce((s, e) => s + e.tokens, 0);
    const morningTokens = more.hourOfDay.filter((e) => e.hour < 12).reduce((s, e) => s + e.tokens, 0);
    if (totalTokens > 0 && morningTokens / totalTokens > 0.4) {
      all.push({ icon: 'sun', title: 'Early Bird', subtitle: `${((morningTokens / totalTokens) * 100).toFixed(0)}% before noon`, color: '#fbbf24' });
    }
  }
  if (stats.totalCost > 100) {
    all.push({ icon: 'diamond', title: 'Big Spender', subtitle: `${formatCost(stats.totalCost, stats.costCompleteness)} total`, color: '#34d399' });
  }
  if (stats.cacheHitRate > 0.5) {
    all.push({ icon: 'target', title: 'Cache Master', subtitle: `${(stats.cacheHitRate * 100).toFixed(0)}% hit rate`, color: '#f472b6' });
  }
  if (stats.topModels.length >= 4) {
    all.push({ icon: 'circle', title: 'Model Hopper', subtitle: `${stats.topModels.length} models used`, color: '#a78bfa' });
  }
  if (stats.totalDays > 0 && stats.activeDays / stats.totalDays > 0.8) {
    all.push({ icon: 'calendar', title: 'Daily Driver', subtitle: `${stats.activeDays}/${stats.totalDays} days active`, color: '#38bdf8' });
  }
  if (stats.averageDailyTokens > 10000) {
    all.push({ icon: 'bolt', title: 'Power User', subtitle: `${formatNumber(stats.averageDailyTokens)} avg/day`, color: '#fbbf24' });
  }
  if (stats.peakDay && stats.peakDay.tokens > 50000) {
    all.push({ icon: 'mountain', title: 'Summit Day', subtitle: `${formatNumber(stats.peakDay.tokens)} in one day`, color: '#34d399' });
  }
  if (providers.length >= 3) {
    all.push({ icon: 'palette', title: 'Multi-Tool', subtitle: `${providers.length} providers`, color: '#c084fc' });
  }
  if (all.length < 3) {
    if (all.length < 3 && stats.longestStreak > 7 && !all.some((a) => a.title === 'Streak Master')) {
      all.push({ icon: 'fire', title: 'Streak Builder', subtitle: `${stats.longestStreak} day streak`, color: '#f59e0b' });
    }
    if (all.length < 3 && stats.totalTokens > 1000) {
      all.push({ icon: 'rocket', title: 'Getting Started', subtitle: `${formatNumber(stats.totalTokens)} tokens used`, color: '#38bdf8' });
    }
    if (all.length < 3 && stats.activeDays > 0) {
      all.push({ icon: 'star', title: 'Active Coder', subtitle: `${stats.activeDays} active days`, color: '#fbbf24' });
    }
    if (all.length < 3 && stats.totalTokens > 0) {
      all.push({ icon: 'bolt', title: 'Token User', subtitle: `${formatNumber(stats.totalTokens)} tokens`, color: '#a78bfa' });
    }
    if (all.length < 3) {
      all.push({ icon: 'rocket', title: 'Just Getting Started', subtitle: 'Your journey begins', color: '#38bdf8' });
    }
  }
  return all.slice(0, 6);
}

// ── SVG Helpers ──────────────────────────────────────────────────────
function sectionBg(
  y: number, height: number, gradColors: [string, string], gradId: string,
): string {
  return [
    `<defs><linearGradient id="${escapeXml(gradId)}" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `<stop offset="0%" stop-color="${escapeXml(gradColors[0])}"/>`,
    `<stop offset="100%" stop-color="${escapeXml(gradColors[1])}"/>`,
    `</linearGradient></defs>`,
    `<rect x="0" y="${y}" width="${WIDTH}" height="${height}" fill="url(#${escapeXml(gradId)})"/>`,
  ].join('');
}

function svgText(
  x: number, y: number, content: string,
  opts: {
    fill?: string; size?: number; weight?: number | string;
    family?: string; anchor?: string; spacing?: number; opacity?: number;
  } = {},
): string {
  const attrs = [
    `x="${x}"`, `y="${y}"`,
    `fill="${escapeXml(opts.fill ?? '#ffffff')}"`,
    `font-size="${opts.size ?? 14}"`,
    `font-family="${escapeXml(opts.family ?? BODY_FONT)}"`,
    `font-weight="${opts.weight ?? 400}"`,
  ];
  if (opts.anchor) attrs.push(`text-anchor="${escapeXml(opts.anchor)}"`);
  if (opts.spacing !== undefined) attrs.push(`letter-spacing="${opts.spacing}"`);
  if (opts.opacity !== undefined) attrs.push(`opacity="${opts.opacity}"`);
  return `<text ${attrs.join(' ')}>${escapeXml(content)}</text>`;
}

function rect(
  x: number, y: number, w: number, h: number, fill: string,
  rx: number = 4,
  opts: { opacity?: number; stroke?: string; strokeWidth?: number } = {},
): string {
  const extra: string[] = [];
  if (opts.opacity !== undefined) extra.push(`opacity="${opts.opacity}"`);
  if (opts.stroke) extra.push(`stroke="${escapeXml(opts.stroke)}" stroke-width="${opts.strokeWidth ?? 1}"`);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${escapeXml(fill)}" ${extra.join(' ')}/>`;
}

function describeArc(
  cx: number, cy: number, radius: number, startAngle: number, endAngle: number,
): string {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(
  cx: number, cy: number, radius: number, angleDeg: number,
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

// ── Geometric decorations ────────────────────────────────────────────
/** Corner bracket: draws an L-shape at the given corner */
function cornerMark(
  x: number, y: number, size: number, color: string,
  corner: 'tl' | 'tr' | 'bl' | 'br',
): string {
  const s = size;
  const paths: Record<string, string> = {
    tl: `M${x} ${y + s} L${x} ${y} L${x + s} ${y}`,
    tr: `M${x - s} ${y} L${x} ${y} L${x} ${y + s}`,
    bl: `M${x} ${y - s} L${x} ${y} L${x + s} ${y}`,
    br: `M${x - s} ${y} L${x} ${y} L${x} ${y - s}`,
  };
  return `<path d="${paths[corner]}" fill="none" stroke="${escapeXml(color)}" stroke-width="1.5" opacity="0.3"/>`;
}

/** Section label with thin tracking and an accent dash before it */
function sectionLabel(x: number, y: number, text: string, color: string, accent: string): string {
  return [
    `<line x1="${x}" y1="${y - 4}" x2="${x + 24}" y2="${y - 4}" stroke="${escapeXml(accent)}" stroke-width="2" opacity="0.6"/>`,
    svgText(x + 32, y, text, { fill: color, size: 11, weight: 600, spacing: 3, family: MONO_FONT }),
  ].join('\n');
}

/** Thin horizontal rule */
function rule(x: number, y: number, width: number, color: string, opacity: number = 0.1): string {
  return `<line x1="${x}" y1="${y}" x2="${x + width}" y2="${y}" stroke="${escapeXml(color)}" stroke-width="1" opacity="${opacity}"/>`;
}

/** Dot grid pattern for background texture */
function dotGrid(
  x: number, y: number, w: number, h: number, color: string, spacing: number = 24, radius: number = 1,
): string {
  const dots: string[] = [];
  for (let gx = x; gx <= x + w; gx += spacing) {
    for (let gy = y; gy <= y + h; gy += spacing) {
      dots.push(`<circle cx="${gx}" cy="${gy}" r="${radius}" fill="${escapeXml(color)}" opacity="0.06"/>`);
    }
  }
  return dots.join('\n');
}

// ── Date formatting ──────────────────────────────────────────────────
function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return dateStr;
  const month = MONTH_NAMES[d.getUTCMonth()] ?? '';
  return `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ── Global SVG defs (noise filter, etc.) ─────────────────────────────
function globalDefs(isDark: boolean): string {
  const noiseOpacity = isDark ? 0.035 : 0.025;
  return [
    '<defs>',
    '<filter id="grain" x="0" y="0" width="100%" height="100%">',
    '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" result="noise"/>',
    '<feColorMatrix type="saturate" values="0" in="noise" result="mono"/>',
    `<feBlend in="SourceGraphic" in2="mono" mode="multiply"/>`,
    '</filter>',
    '</defs>',
    // Full-width noise overlay
    `<rect width="${WIDTH}" height="99999" fill="transparent" filter="url(#grain)" opacity="${noiseOpacity}" pointer-events="none"/>`,
  ].join('\n');
}

// ── Slide 1: Title Card ──────────────────────────────────────────────
function renderTitleSlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const height = 300;
  const p: string[] = [];
  const gc = theme.sectionBgs[0] ?? ['#08080c', '#0c0c14'];
  p.push(sectionBg(0, height, gc as [string, string], 'title-bg'));

  // Dot grid texture in top-right
  const gridColor = theme.mode === 'dark' ? '#ffffff' : '#000000';
  p.push(dotGrid(WIDTH - 300, 30, 220, 120, gridColor, 20, 1.2));

  // Corner marks
  p.push(cornerMark(PAD - 16, 40, 20, theme.heroAccent, 'tl'));
  p.push(cornerMark(WIDTH - PAD + 16, height - 40, 20, theme.heroAccent, 'br'));

  // "Your AI Coding" — smaller, lighter
  const titleColor = theme.mode === 'dark' ? '#e5e7eb' : '#1f2937';
  p.push(svgText(PAD, 100, 'Your AI Coding', {
    fill: titleColor, size: 36, weight: 300, family: DISPLAY_FONT, spacing: -0.5,
  }));

  // "Wrapped" — massive, accent color
  p.push(svgText(PAD, 160, 'Wrapped', {
    fill: theme.heroAccent, size: 80, weight: 800, family: DISPLAY_FONT, spacing: -3,
  }));

  // Thin accent line under title
  p.push(`<line x1="${PAD}" y1="${178}" x2="${PAD + 120}" y2="${178}" stroke="${escapeXml(theme.heroAccent)}" stroke-width="2" opacity="0.4"/>`);

  // Date range in mono
  const { since, until } = output.dateRange;
  const rangeText = `${formatDateLong(since)} — ${formatDateLong(until)}`;
  p.push(svgText(PAD, 210, rangeText, {
    fill: theme.subtitleColor, size: 14, weight: 400, family: MONO_FONT,
  }));

  // Watermark
  p.push(svgText(PAD, 248, 'tokenleak', {
    fill: theme.heroAccent, size: 13, weight: 500, family: MONO_FONT, opacity: 0.4,
  }));

  // Bottom rule
  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 2: Big Numbers ─────────────────────────────────────────────
function renderBigNumbersSlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const height = 260;
  const p: string[] = [];
  const stats = output.aggregated;
  const gc = theme.sectionBgs[1] ?? ['#0a0a12', '#0e0e18'];
  p.push(sectionBg(0, height, gc as [string, string], 'bignums-bg'));

  p.push(sectionLabel(PAD, 40, 'THE BIG NUMBERS', theme.subtitleColor, theme.heroAccent));

  // Massive token count
  const numColor = theme.mode === 'dark' ? '#f9fafb' : '#111827';
  p.push(svgText(PAD, 130, formatNumber(stats.totalTokens), {
    fill: numColor, size: 96, weight: 800, family: MONO_FONT, spacing: -4,
  }));
  p.push(svgText(PAD, 158, 'total tokens', {
    fill: theme.subtitleColor, size: 14, weight: 500, family: BODY_FONT, spacing: 1,
  }));

  // Three supporting stats separated by thin vertical rules
  const statsY = 200;
  const colW = (WIDTH - PAD * 2) / 3;
  const supportStats = [
    { value: formatCost(stats.totalCost, stats.costCompleteness), label: 'TOTAL COST', accent: true },
    { value: `${stats.activeDays}`, label: 'ACTIVE DAYS', accent: false },
    { value: `${stats.totalDays}`, label: 'TOTAL DAYS', accent: false },
  ];

  for (let i = 0; i < supportStats.length; i++) {
    const sx = PAD + i * colW;
    const stat = supportStats[i]!;
    // Vertical separator
    if (i > 0) {
      p.push(`<line x1="${sx}" y1="${statsY - 10}" x2="${sx}" y2="${statsY + 32}" stroke="${theme.mode === 'dark' ? '#ffffff' : '#000000'}" stroke-width="1" opacity="0.08"/>`);
    }
    p.push(svgText(sx + (i > 0 ? 20 : 0), statsY + 4, stat.value, {
      fill: stat.accent ? theme.greenAccent : numColor,
      size: 28, weight: 700, family: MONO_FONT,
    }));
    p.push(svgText(sx + (i > 0 ? 20 : 0), statsY + 28, stat.label, {
      fill: theme.subtitleColor, size: 10, weight: 600, spacing: 2, family: MONO_FONT,
    }));
  }

  // Bottom rule
  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 3: Streak Story ────────────────────────────────────────────
function renderStreakSlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const height = 250;
  const p: string[] = [];
  const stats = output.aggregated;
  const gc = theme.sectionBgs[2] ?? ['#0c0a08', '#100e0c'];
  p.push(sectionBg(0, height, gc as [string, string], 'streak-bg'));

  p.push(sectionLabel(PAD, 40, 'STREAK STORY', theme.subtitleColor, theme.warmAccent));

  const narrative = stats.longestStreak > 0
    ? `Your longest coding streak was ${stats.longestStreak} days`
    : 'Start your first coding streak!';
  p.push(svgText(PAD, 85, narrative, {
    fill: theme.narrativeColor, size: 20, weight: 500, family: DISPLAY_FONT,
  }));

  // Giant streak number
  p.push(svgText(PAD, 170, `${stats.longestStreak}`, {
    fill: theme.warmAccent, size: 88, weight: 800, family: MONO_FONT, spacing: -4,
  }));

  // "days" label beside the number
  const numWidth = Math.max(60, `${stats.longestStreak}`.length * 50);
  p.push(svgText(PAD + numWidth + 8, 170, 'days', {
    fill: theme.subtitleColor, size: 20, weight: 400, family: DISPLAY_FONT,
  }));

  // Fire icon
  p.push(svgIconFire(PAD + numWidth + 8, 120, 40, theme.warmAccent));

  // Current streak — right aligned
  p.push(svgText(WIDTH - PAD, 170, `Current: ${stats.currentStreak}`, {
    fill: theme.subtitleColor, size: 14, weight: 500, family: MONO_FONT, anchor: 'end',
  }));

  // Streak bar — a continuous gradient strip instead of dots
  const barY = 198;
  const barW = WIDTH - PAD * 2;
  const barH = 6;
  const streakRatio = Math.min(stats.longestStreak / 30, 1);
  const trackColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  p.push(rect(PAD, barY, barW, barH, trackColor, 3));
  if (streakRatio > 0) {
    p.push(rect(PAD, barY, Math.max(8, streakRatio * barW), barH, theme.warmAccent, 3, { opacity: 0.7 }));
  }

  // Tick marks on streak bar
  for (let i = 0; i <= 30 && i <= stats.longestStreak; i += 5) {
    if (i === 0) continue;
    const tx = PAD + (i / 30) * barW;
    p.push(`<line x1="${tx}" y1="${barY + barH + 2}" x2="${tx}" y2="${barY + barH + 6}" stroke="${escapeXml(theme.subtitleColor)}" stroke-width="1" opacity="0.3"/>`);
  }

  // Bottom rule
  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 4: Top Model ───────────────────────────────────────────────
function renderTopModelSlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const height = 300;
  const p: string[] = [];
  const stats = output.aggregated;
  const topModels = stats.topModels.slice(0, 3);
  const gc = theme.sectionBgs[3] ?? ['#080c14', '#0c1018'];
  p.push(sectionBg(0, height, gc as [string, string], 'model-bg'));

  p.push(sectionLabel(PAD, 40, 'YOUR TOP MODEL', theme.subtitleColor, theme.coolAccent));

  if (topModels.length === 0) {
    p.push(svgText(PAD, 160, 'No model data available', {
      fill: theme.subtitleColor, size: 18, weight: 500,
    }));
    return { svg: p.join('\n'), height };
  }

  const topModel = topModels[0]!;
  const arcColors = [theme.coolAccent, theme.purpleAccent, theme.greenAccent, theme.warmAccent];

  // Top model name + percentage — large
  p.push(svgText(PAD, 100, topModel.model, {
    fill: theme.coolAccent, size: 32, weight: 700, family: MONO_FONT, spacing: -1,
  }));
  p.push(svgText(PAD, 128, `${topModel.percentage.toFixed(0)}% of all tokens`, {
    fill: theme.subtitleColor, size: 14, weight: 500,
  }));

  // Segmented bar — full width, showing model proportions
  const segBarY = 150;
  const segBarH = 20;
  const segBarW = WIDTH - PAD * 2;
  const trackBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  p.push(rect(PAD, segBarY, segBarW, segBarH, trackBg, 4));

  let segX = PAD;
  for (let i = 0; i < topModels.length; i++) {
    const model = topModels[i]!;
    const w = Math.max(4, (model.percentage / 100) * segBarW);
    const gap = i > 0 ? 2 : 0;
    p.push(rect(segX + gap, segBarY, w - gap, segBarH, arcColors[i % arcColors.length]!, 4, { opacity: 0.85 }));
    segX += w;
  }

  // Model list below
  const listY = 195;
  for (let i = 0; i < topModels.length; i++) {
    const model = topModels[i]!;
    const my = listY + i * 32;
    // Color dot
    p.push(`<rect x="${PAD}" y="${my + 2}" width="4" height="16" rx="2" fill="${escapeXml(arcColors[i % arcColors.length]!)}" opacity="0.9"/>`);
    // Rank
    p.push(svgText(PAD + 16, my + 14, `${model.model}`, {
      fill: theme.mode === 'dark' ? '#e5e7eb' : '#1f2937',
      size: 14, weight: 600, family: MONO_FONT,
    }));
    // Percentage — right aligned
    p.push(svgText(WIDTH - PAD, my + 14, `${model.percentage.toFixed(0)}%`, {
      fill: arcColors[i % arcColors.length]!,
      size: 14, weight: 700, family: MONO_FONT, anchor: 'end',
    }));
    // Thin bar
    const barW = Math.max(4, (model.percentage / 100) * (segBarW - 200));
    p.push(rect(PAD + 16, my + 20, barW, 4, arcColors[i % arcColors.length]!, 2, { opacity: 0.4 }));
  }

  // Bottom rule
  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 5: Provider Mix ────────────────────────────────────────────
function renderProviderMixSlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const providers = output.providers;
  const perRow = 52;
  const height = Math.max(180, 100 + providers.length * perRow);
  const p: string[] = [];
  const gc = theme.sectionBgs[4] ?? ['#0a0a0e', '#0e0e12'];
  p.push(sectionBg(0, height, gc as [string, string], 'provider-bg'));

  p.push(sectionLabel(PAD, 40, 'PROVIDER MIX', theme.subtitleColor, theme.purpleAccent));

  if (providers.length === 0) {
    p.push(svgText(PAD, 110, 'No provider data', { fill: theme.subtitleColor, size: 16, weight: 500 }));
    return { svg: p.join('\n'), height: 180 };
  }

  const totalTokens = providers.reduce((s, pv) => s + pv.totalTokens, 0);
  const topProvider = providers.reduce((a, b) => (a.totalTokens >= b.totalTokens ? a : b));
  const topPct = totalTokens > 0 ? ((topProvider.totalTokens / totalTokens) * 100).toFixed(0) : '0';

  p.push(svgText(PAD, 80, `${topProvider.displayName} — ${topPct}%`, {
    fill: theme.narrativeColor, size: 20, weight: 600, family: DISPLAY_FONT,
  }));

  const barMaxWidth = WIDTH - PAD * 2 - 160;
  for (let i = 0; i < providers.length; i++) {
    const pv = providers[i]!;
    const py = 105 + i * perRow;
    const pct = totalTokens > 0 ? (pv.totalTokens / totalTokens) * 100 : 0;

    // Color indicator
    p.push(`<rect x="${PAD}" y="${py + 4}" width="4" height="14" rx="2" fill="${escapeXml(pv.colors.primary)}"/>`);
    p.push(svgText(PAD + 16, py + 15, pv.displayName, {
      fill: theme.mode === 'dark' ? '#e5e7eb' : '#1f2937',
      size: 14, weight: 600, family: MONO_FONT,
    }));
    p.push(svgText(WIDTH - PAD, py + 15, `${pct.toFixed(0)}%`, {
      fill: theme.subtitleColor, size: 13, weight: 700, anchor: 'end', family: MONO_FONT,
    }));
    const trackBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
    p.push(rect(PAD + 16, py + 24, barMaxWidth, 8, trackBg, 4));
    const barW = Math.max(4, (pct / 100) * barMaxWidth);
    p.push(rect(PAD + 16, py + 24, barW, 8, pv.colors.primary, 4, { opacity: 0.75 }));
  }

  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 6: Day of Week ─────────────────────────────────────────────
function renderDayOfWeekSlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const height = 340;
  const p: string[] = [];
  const dow = output.aggregated.dayOfWeek;
  const gc = theme.sectionBgs[5] ?? ['#080c14', '#0c1018'];
  p.push(sectionBg(0, height, gc as [string, string], 'dow-bg'));

  p.push(sectionLabel(PAD, 40, 'CODING DAYS', theme.subtitleColor, theme.coolAccent));

  if (dow.length === 0) {
    p.push(svgText(PAD, 170, 'No day-of-week data', { fill: theme.subtitleColor, size: 16, weight: 500 }));
    return { svg: p.join('\n'), height };
  }

  const peak = dow.reduce((a, b) => (a.tokens >= b.tokens ? a : b));
  const peakName = DAY_NAMES[peak.day] ?? 'Unknown';
  const maxTokens = Math.max(...dow.map((d) => d.tokens), 1);

  p.push(svgText(PAD, 80, `${peakName}s are your power day`, {
    fill: theme.narrativeColor, size: 20, weight: 600, family: DISPLAY_FONT,
  }));

  const chartX = PAD;
  const chartY = 110;
  const barAreaWidth = WIDTH - PAD * 2;
  const gapSize = 12;
  const barWidth = Math.floor((barAreaWidth - 6 * gapSize) / 7);
  const barMaxHeight = 170;

  for (let i = 0; i < 7 && i < dow.length; i++) {
    const entry = dow[i]!;
    const bx = chartX + i * (barWidth + gapSize);
    const ratio = maxTokens > 0 ? entry.tokens / maxTokens : 0;
    const barH = Math.max(4, ratio * barMaxHeight);
    const by = chartY + barMaxHeight - barH;
    const isPeak = entry.day === peak.day;

    const barColor = isPeak
      ? theme.coolAccent
      : (theme.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)');
    p.push(rect(bx, by, barWidth, barH, barColor, 4, { opacity: isPeak ? 1 : 0.7 }));

    // Peak highlight — thin top accent
    if (isPeak) {
      p.push(`<line x1="${bx}" y1="${by}" x2="${bx + barWidth}" y2="${by}" stroke="${escapeXml(theme.coolAccent)}" stroke-width="3" opacity="0.8"/>`);
    }

    const dayLabel = DAY_SHORT[i] ?? '';
    p.push(svgText(bx + barWidth / 2, chartY + barMaxHeight + 20, dayLabel, {
      fill: isPeak ? theme.coolAccent : theme.subtitleColor,
      size: 11, weight: isPeak ? 700 : 500, anchor: 'middle', family: MONO_FONT,
    }));

    if (isPeak) {
      p.push(svgText(bx + barWidth / 2, by - 10, formatNumber(entry.tokens), {
        fill: theme.coolAccent, size: 11, weight: 700, anchor: 'middle', family: MONO_FONT,
      }));
    }
  }

  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 7: Time of Day ─────────────────────────────────────────────
function renderTimeOfDaySlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const more = output.more;
  if (!more?.hourOfDay) return { svg: '', height: 0 };

  const hourOfDay = more.hourOfDay;
  const totalTokens = hourOfDay.reduce((s, e) => s + e.tokens, 0);
  if (totalTokens === 0) return { svg: '', height: 0 };

  const height = 320;
  const p: string[] = [];
  const gc = theme.sectionBgs[6] ?? ['#0c0814', '#100c18'];
  p.push(sectionBg(0, height, gc as [string, string], 'tod-bg'));

  p.push(sectionLabel(PAD, 40, 'WHEN YOU CODE', theme.subtitleColor, theme.purpleAccent));

  const morning = hourOfDay.filter((e) => e.hour >= 6 && e.hour < 12).reduce((s, e) => s + e.tokens, 0);
  const afternoon = hourOfDay.filter((e) => e.hour >= 12 && e.hour < 18).reduce((s, e) => s + e.tokens, 0);
  const evening = hourOfDay.filter((e) => e.hour >= 18 && e.hour < 22).reduce((s, e) => s + e.tokens, 0);
  const night = hourOfDay.filter((e) => e.hour >= 22 || e.hour < 6).reduce((s, e) => s + e.tokens, 0);

  const periods = [
    { label: 'Morning', icon: 'sun' as IconName, tokens: morning, color: theme.warmAccent, hours: '6am–12pm' },
    { label: 'Afternoon', icon: 'star' as IconName, tokens: afternoon, color: theme.goldAccent, hours: '12–6pm' },
    { label: 'Evening', icon: 'fire' as IconName, tokens: evening, color: theme.purpleAccent, hours: '6–10pm' },
    { label: 'Night', icon: 'moon' as IconName, tokens: night, color: theme.coolAccent, hours: '10pm–6am' },
  ];

  const dominant = periods.reduce((a, b) => (a.tokens >= b.tokens ? a : b));
  const dominantPct = totalTokens > 0 ? ((dominant.tokens / totalTokens) * 100).toFixed(0) : '0';

  let narrativeText = '';
  if (dominant.label === 'Night') narrativeText = `You're a night owl -- ${dominantPct}% of tokens between 10pm-6am`;
  else if (dominant.label === 'Evening') narrativeText = `You're an evening coder -- ${dominantPct}% between 6-10pm`;
  else if (dominant.label === 'Morning') narrativeText = `You're an early bird -- ${dominantPct}% before noon`;
  else narrativeText = `Afternoons are your peak -- ${dominantPct}% from 12-6pm`;

  p.push(svgText(PAD, 80, narrativeText, {
    fill: theme.narrativeColor, size: 18, weight: 500, family: DISPLAY_FONT,
  }));

  // Four period cards — sharp edges, minimal
  const cardGap = 16;
  const cardWidth = (WIDTH - PAD * 2 - 3 * cardGap) / 4;
  const cardsY = 110;
  const cardH = 170;

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]!;
    const cx = PAD + i * (cardWidth + cardGap);
    const pct = totalTokens > 0 ? (period.tokens / totalTokens) * 100 : 0;
    const isDominant = period.label === dominant.label;

    const cardBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
    const borderColor = isDominant ? period.color : 'transparent';
    p.push(rect(cx, cardsY, cardWidth, cardH, cardBg, 6, {
      stroke: borderColor,
      strokeWidth: isDominant ? 1.5 : 0,
      opacity: 1,
    }));

    // Top accent line for dominant
    if (isDominant) {
      p.push(`<line x1="${cx}" y1="${cardsY}" x2="${cx + cardWidth}" y2="${cardsY}" stroke="${escapeXml(period.color)}" stroke-width="2" opacity="0.8"/>`);
    }

    // Icon
    p.push(renderIcon(period.icon, cx + cardWidth / 2 - 12, cardsY + 20, 24, period.color));

    // Period label
    p.push(svgText(cx + cardWidth / 2, cardsY + 65, period.label, {
      fill: theme.subtitleColor, size: 11, weight: 600, anchor: 'middle', family: MONO_FONT, spacing: 1,
    }));

    // Big percentage
    p.push(svgText(cx + cardWidth / 2, cardsY + 110, `${pct.toFixed(0)}%`, {
      fill: period.color, size: 36, weight: 800, anchor: 'middle', family: MONO_FONT,
    }));

    // Token count
    p.push(svgText(cx + cardWidth / 2, cardsY + 135, formatNumber(period.tokens), {
      fill: theme.subtitleColor, size: 11, weight: 400, anchor: 'middle', family: MONO_FONT,
    }));

    // Hours label
    p.push(svgText(cx + cardWidth / 2, cardsY + 155, period.hours, {
      fill: theme.subtitleColor, size: 10, weight: 400, anchor: 'middle', family: MONO_FONT, opacity: 0.5,
    }));
  }

  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 8: Cache Efficiency ────────────────────────────────────────
function renderCacheSlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const height = 280;
  const p: string[] = [];
  const stats = output.aggregated;
  const gc = theme.sectionBgs[7] ?? ['#080e0c', '#0c1210'];
  p.push(sectionBg(0, height, gc as [string, string], 'cache-bg'));

  p.push(sectionLabel(PAD, 40, 'CACHE EFFICIENCY', theme.subtitleColor, theme.greenAccent));

  const hitRate = stats.cacheHitRate;
  const hitPct = (hitRate * 100).toFixed(1);

  // Gauge arc — right side
  const gaugeCx = WIDTH - 220;
  const gaugeCy = 160;
  const gaugeR = 80;
  const gaugeWidth = 14;

  const trackColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const bgArc = describeArc(gaugeCx, gaugeCy, gaugeR, -90, 270);
  p.push(`<path d="${bgArc}" fill="none" stroke="${trackColor}" stroke-width="${gaugeWidth}" stroke-linecap="round"/>`);

  if (hitRate > 0) {
    const sweepAngle = Math.min(hitRate * 360, 359);
    const fillArc = describeArc(gaugeCx, gaugeCy, gaugeR, -90, -90 + sweepAngle);
    p.push(`<path d="${fillArc}" fill="none" stroke="${escapeXml(theme.greenAccent)}" stroke-width="${gaugeWidth}" stroke-linecap="round"/>`);
  }

  // Percentage in center of gauge
  p.push(svgText(gaugeCx, gaugeCy + 8, `${hitPct}%`, {
    fill: theme.greenAccent, size: 28, weight: 800, anchor: 'middle', family: MONO_FONT,
  }));
  p.push(svgText(gaugeCx, gaugeCy + 28, 'hit rate', {
    fill: theme.subtitleColor, size: 11, weight: 500, anchor: 'middle', family: MONO_FONT,
  }));

  // Left side stats
  p.push(svgText(PAD, 100, `${hitPct}% Cache Hit Rate`, {
    fill: theme.narrativeColor, size: 22, weight: 600, family: DISPLAY_FONT,
  }));

  const cacheEcon = output.more?.cacheEconomics;
  if (cacheEcon) {
    const statItems = [
      { label: 'Cache Reads', value: formatNumber(cacheEcon.readTokens) },
      { label: 'Cache Writes', value: formatNumber(cacheEcon.writeTokens) },
    ];
    if (cacheEcon.reuseRatio !== null && Number.isFinite(cacheEcon.reuseRatio)) {
      statItems.push({ label: 'Reuse Ratio', value: `${cacheEcon.reuseRatio.toFixed(1)}x` });
    }
    for (let i = 0; i < statItems.length; i++) {
      const item = statItems[i]!;
      const iy = 135 + i * 34;
      p.push(svgText(PAD, iy, item.value, {
        fill: theme.mode === 'dark' ? '#e5e7eb' : '#1f2937',
        size: 18, weight: 700, family: MONO_FONT,
      }));
      p.push(svgText(PAD + 140, iy, item.label, {
        fill: theme.subtitleColor, size: 12, weight: 500, family: MONO_FONT,
      }));
    }
  }

  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 9: Peak Day Spotlight ──────────────────────────────────────
function renderPeakDaySlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const height = 240;
  const p: string[] = [];
  const stats = output.aggregated;
  const gc = theme.sectionBgs[8] ?? ['#0c0a06', '#100e0a'];
  p.push(sectionBg(0, height, gc as [string, string], 'peak-bg'));

  p.push(sectionLabel(PAD, 40, 'PEAK DAY SPOTLIGHT', theme.subtitleColor, theme.goldAccent));

  if (!stats.peakDay) {
    p.push(svgText(PAD, 130, 'No usage data recorded yet', {
      fill: theme.subtitleColor, size: 16, weight: 500,
    }));
    return { svg: p.join('\n'), height };
  }

  const formattedDate = formatDateLong(stats.peakDay.date);
  p.push(svgText(PAD, 85, `${formattedDate} was your biggest day`, {
    fill: theme.narrativeColor, size: 20, weight: 500, family: DISPLAY_FONT,
  }));

  // Massive token count
  p.push(svgText(PAD, 160, formatNumber(stats.peakDay.tokens), {
    fill: theme.goldAccent, size: 72, weight: 800, family: MONO_FONT, spacing: -3,
  }));
  p.push(svgText(PAD, 190, 'tokens in a single day', {
    fill: theme.subtitleColor, size: 14, weight: 500,
  }));

  // Trophy on right — inside a sharp-cornered box
  const badgeCx = WIDTH - 180;
  const badgeCy = 140;
  p.push(rect(badgeCx - 40, badgeCy - 36, 80, 72, theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', 6));
  p.push(cornerMark(badgeCx - 40, badgeCy - 36, 12, theme.goldAccent, 'tl'));
  p.push(cornerMark(badgeCx + 40, badgeCy + 36, 12, theme.goldAccent, 'br'));
  p.push(svgIconTrophy(badgeCx - 20, badgeCy - 20, 40, theme.goldAccent));

  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 10: Achievements ───────────────────────────────────────────
function renderAchievementsSlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const achievements = computeAchievements(output);
  const rows = Math.ceil(achievements.length / 2);
  const rowHeight = 80;
  const height = Math.max(200, 90 + rows * rowHeight + 20);
  const p: string[] = [];
  const gc = theme.sectionBgs[9] ?? ['#08080c', '#0c0c14'];
  p.push(sectionBg(0, height, gc as [string, string], 'achieve-bg'));

  p.push(sectionLabel(PAD, 40, 'ACHIEVEMENTS UNLOCKED', theme.subtitleColor, theme.purpleAccent));

  if (achievements.length === 0) {
    p.push(svgText(PAD, 120, 'Keep coding to unlock achievements!', {
      fill: theme.subtitleColor, size: 16, weight: 500,
    }));
    return { svg: p.join('\n'), height: 200 };
  }

  const colWidth = (WIDTH - PAD * 2 - 20) / 2;
  for (let i = 0; i < achievements.length; i++) {
    const a = achievements[i]!;
    const col = i % 2;
    const row = Math.floor(i / 2);
    const ax = PAD + col * (colWidth + 20);
    const ay = 70 + row * rowHeight;

    const cardBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
    p.push(rect(ax, ay, colWidth, 66, cardBg, 6));

    // Left accent bar
    p.push(`<rect x="${ax}" y="${ay}" width="3" height="66" rx="1.5" fill="${escapeXml(a.color)}" opacity="0.7"/>`);

    // Icon
    p.push(renderIcon(a.icon, ax + 16, ay + 17, 32, a.color));

    // Title
    p.push(svgText(ax + 60, ay + 28, a.title, {
      fill: theme.mode === 'dark' ? '#f3f4f6' : '#1f2937',
      size: 15, weight: 700, family: DISPLAY_FONT,
    }));

    // Subtitle
    p.push(svgText(ax + 60, ay + 48, a.subtitle, {
      fill: theme.subtitleColor, size: 12, weight: 500, family: MONO_FONT,
    }));
  }

  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 11: Monthly Burn Projection ────────────────────────────────
function renderMonthlyBurnSlide(
  output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const height = 260;
  const p: string[] = [];
  const gc = theme.sectionBgs[10] ?? ['#0a0c10', '#0e1014'];
  p.push(sectionBg(0, height, gc as [string, string], 'burn-bg'));

  p.push(sectionLabel(PAD, 40, 'MONTHLY PROJECTION', theme.subtitleColor, theme.coolAccent));

  const burn = output.more?.monthlyBurn;
  if (!burn) {
    const avgDailyCost = output.aggregated.averageDailyCost;
    const projected = avgDailyCost * 30;
    p.push(svgText(PAD, 90, 'At this rate, you will spend about', {
      fill: theme.narrativeColor, size: 18, weight: 500, family: DISPLAY_FONT,
    }));
    p.push(svgText(PAD, 160, formatCost(projected, output.aggregated.costCompleteness), {
      fill: theme.coolAccent, size: 64, weight: 800, family: MONO_FONT, spacing: -3,
    }));
    p.push(svgText(PAD, 190, 'per month', {
      fill: theme.subtitleColor, size: 14, weight: 500,
    }));
    return { svg: p.join('\n'), height };
  }

  p.push(svgText(PAD, 90, 'At this rate, you will spend', {
    fill: theme.narrativeColor, size: 18, weight: 500, family: DISPLAY_FONT,
  }));
  p.push(svgText(PAD, 155, formatCost(burn.projectedCost, output.aggregated.costCompleteness), {
    fill: theme.coolAccent, size: 64, weight: 800, family: MONO_FONT, spacing: -3,
  }));
  p.push(svgText(PAD, 185, 'this month', {
    fill: theme.subtitleColor, size: 14, weight: 500,
  }));

  // Progress bar
  const barY = 210;
  const barWidth = WIDTH - PAD * 2;
  const barHeight = 10;
  const progress = burn.calendarDays > 0 ? burn.observedDays / burn.calendarDays : 0;

  const trackBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  p.push(rect(PAD, barY, barWidth, barHeight, trackBg, 5));
  p.push(rect(PAD, barY, Math.max(6, progress * barWidth), barHeight, theme.coolAccent, 5, { opacity: 0.7 }));

  p.push(svgText(PAD, barY + 30, `Based on ${burn.observedDays} of ${burn.calendarDays} days`, {
    fill: theme.subtitleColor, size: 11, weight: 400, family: MONO_FONT,
  }));

  p.push(rule(PAD, height - 1, WIDTH - PAD * 2, theme.mode === 'dark' ? '#ffffff' : '#000000', 0.06));

  return { svg: p.join('\n'), height };
}

// ── Slide 12: Footer ─────────────────────────────────────────────────
function renderFooterSlide(
  _output: TokenleakOutput, theme: WrappedTheme,
): SlideResult {
  const height = 100;
  const p: string[] = [];
  const gc = theme.sectionBgs[11] ?? ['#060608', '#060608'];
  p.push(sectionBg(0, height, gc as [string, string], 'footer-bg'));

  // Corner mark
  p.push(cornerMark(PAD - 16, height - 16, 16, theme.heroAccent, 'bl'));

  p.push(svgText(PAD, 40, 'Generated by tokenleak', {
    fill: theme.subtitleColor, size: 12, weight: 500, family: MONO_FONT,
  }));

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  p.push(svgText(PAD, 60, now, {
    fill: theme.subtitleColor, size: 11, weight: 400, family: MONO_FONT, opacity: 0.5,
  }));

  p.push(svgText(WIDTH - PAD, 50, 'tokenleak', {
    fill: theme.heroAccent, size: 16, weight: 700, anchor: 'end', family: MONO_FONT, opacity: 0.4,
  }));

  return { svg: p.join('\n'), height };
}

// ── Main composer ────────────────────────────────────────────────────
export function renderWrappedSlidesSvg(
  output: TokenleakOutput,
  options: { theme: 'dark' | 'light' },
): string {
  const theme = getWrappedTheme(options.theme);

  const slides = [
    renderTitleSlide(output, theme),
    renderBigNumbersSlide(output, theme),
    renderStreakSlide(output, theme),
    renderTopModelSlide(output, theme),
    renderProviderMixSlide(output, theme),
    renderDayOfWeekSlide(output, theme),
    renderTimeOfDaySlide(output, theme),
    renderCacheSlide(output, theme),
    renderPeakDaySlide(output, theme),
    renderAchievementsSlide(output, theme),
    renderMonthlyBurnSlide(output, theme),
    renderFooterSlide(output, theme),
  ].filter((s) => s.height > 0);

  let totalHeight = 0;
  const stackedSections: string[] = [];

  for (const slide of slides) {
    stackedSections.push(
      `<g transform="translate(0, ${totalHeight})">`,
      slide.svg,
      '</g>',
    );
    totalHeight += slide.height;
  }

  const bgColor = theme.mode === 'dark' ? '#060608' : '#fafaf9';

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${totalHeight}" viewBox="0 0 ${WIDTH} ${totalHeight}" shape-rendering="geometricPrecision" text-rendering="optimizeLegibility" color-rendering="optimizeQuality">`,
    `<rect width="${WIDTH}" height="${totalHeight}" fill="${escapeXml(bgColor)}"/>`,
    globalDefs(theme.mode === 'dark'),
    ...stackedSections,
    '</svg>',
  ].join('\n');
}
