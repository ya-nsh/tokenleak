import type { TokenleakOutput } from '@tokenleak/core';
import { escapeXml, formatNumber, formatCost } from './utils';
import { getTheme } from './theme';
import type { SvgTheme } from './theme';

// ── Constants ────────────────────────────────────────────────────────
const WIDTH = 1200;
const INNER_PAD = 80;
const DISPLAY_FONT =
  "'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO_FONT =
  "'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace";

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Per-slide accent colors ──────────────────────────────────────────
const ACCENT = {
  cyan: '#00F5FF',
  green: '#39FF14',
  coral: '#FF4757',
  amber: '#FFB347',
  purple: '#C084FC',
} as const;

const SLIDE_ACCENTS_DARK = [
  ACCENT.cyan,    // 1  Title
  ACCENT.green,   // 2  Big Numbers
  ACCENT.coral,   // 3  Streak
  ACCENT.cyan,    // 4  Top Model
  ACCENT.amber,   // 5  Provider Mix
  ACCENT.cyan,    // 6  Day of Week
  ACCENT.purple,  // 7  Time of Day
  ACCENT.green,   // 8  Cache
  ACCENT.amber,   // 9  Peak Day
  ACCENT.purple,  // 10 Achievements
  ACCENT.cyan,    // 11 Projection
  ACCENT.cyan,    // 12 Footer (gradient of all)
] as const;

const SLIDE_ACCENTS_LIGHT = [
  '#0891B2',  // 1  Title
  '#16A34A',  // 2  Big Numbers
  '#DC2626',  // 3  Streak
  '#0891B2',  // 4  Top Model
  '#D97706',  // 5  Provider Mix
  '#0891B2',  // 6  Day of Week
  '#9333EA',  // 7  Time of Day
  '#16A34A',  // 8  Cache
  '#D97706',  // 9  Peak Day
  '#9333EA',  // 10 Achievements
  '#0891B2',  // 11 Projection
  '#0891B2',  // 12 Footer
] as const;

// ── Theme extension for wrapped ──────────────────────────────────────
interface WrappedTheme {
  base: SvgTheme;
  mode: 'dark' | 'light';
  bg: string;
  fg: string;
  fgMuted: string;
  fgDim: string;
  cardBg: string;
  slideAccents: readonly string[];
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
      bg: '#0A0A0F',
      fg: '#F1F5F9',
      fgMuted: '#94A3B8',
      fgDim: '#64748B',
      cardBg: 'rgba(255,255,255,0.06)',
      slideAccents: SLIDE_ACCENTS_DARK,
      heroAccent: ACCENT.cyan,
      warmAccent: ACCENT.coral,
      coolAccent: ACCENT.cyan,
      greenAccent: ACCENT.green,
      goldAccent: ACCENT.amber,
      purpleAccent: ACCENT.purple,
      narrativeColor: '#CBD5E1',
      subtitleColor: '#94A3B8',
    };
  }
  return {
    base,
    mode,
    bg: '#F8F9FC',
    fg: '#1A1A2E',
    fgMuted: '#64748B',
    fgDim: '#94A3B8',
    cardBg: 'rgba(0,0,0,0.04)',
    slideAccents: SLIDE_ACCENTS_LIGHT,
    heroAccent: '#0891B2',
    warmAccent: '#DC2626',
    coolAccent: '#0891B2',
    greenAccent: '#16A34A',
    goldAccent: '#D97706',
    purpleAccent: '#9333EA',
    narrativeColor: '#334155',
    subtitleColor: '#64748B',
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
    fire: svgIconFire, star: svgIconStar, circle: svgIconCircle, diamond: svgIconDiamond,
    bolt: svgIconBolt, trophy: svgIconTrophy, target: svgIconTarget, mountain: svgIconMountain,
    palette: svgIconPalette, calendar: svgIconCalendar, moon: svgIconMoon, sun: svgIconSun,
    rocket: svgIconRocket,
  };
  return fns[name](x, y, size, color);
}

// ── Achievement types & computation ──────────────────────────────────
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
    all.push({ icon: 'diamond', title: 'Big Spender', subtitle: `${formatCost(stats.totalCost)} total`, color: '#34d399' });
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
function svgText(
  x: number,
  y: number,
  content: string,
  opts: {
    fill?: string;
    size?: number;
    weight?: number | string;
    family?: string;
    anchor?: string;
    spacing?: number;
    opacity?: number;
  } = {},
): string {
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `fill="${escapeXml(opts.fill ?? '#ffffff')}"`,
    `font-size="${opts.size ?? 14}"`,
    `font-family="${escapeXml(opts.family ?? DISPLAY_FONT)}"`,
    `font-weight="${opts.weight ?? 400}"`,
  ];
  if (opts.anchor) attrs.push(`text-anchor="${escapeXml(opts.anchor)}"`);
  if (opts.spacing !== undefined) attrs.push(`letter-spacing="${opts.spacing}"`);
  if (opts.opacity !== undefined) attrs.push(`opacity="${opts.opacity}"`);
  return `<text ${attrs.join(' ')}>${escapeXml(content)}</text>`;
}

function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  rx: number = 16,
  opts: { opacity?: number; stroke?: string; strokeWidth?: number } = {},
): string {
  const extra: string[] = [];
  if (opts.opacity !== undefined) extra.push(`opacity="${opts.opacity}"`);
  if (opts.stroke) extra.push(`stroke="${escapeXml(opts.stroke)}" stroke-width="${opts.strokeWidth ?? 1}"`);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${escapeXml(fill)}" ${extra.join(' ')}/>`;
}

function sectionHeader(x: number, y: number, text: string, theme: WrappedTheme): string {
  return svgText(x, y, text, {
    fill: theme.fgMuted,
    size: 13,
    weight: 700,
    spacing: 3,
    family: MONO_FONT,
  });
}

// ── SVG arc helpers ──────────────────────────────────────────────────
function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

// ── New helpers ──────────────────────────────────────────────────────
function glowCircle(cx: number, cy: number, r: number, color: string, opacity: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${escapeXml(color)}" opacity="${opacity}"/>`;
}

function renderScanlines(y: number, height: number): string {
  const lines: string[] = [];
  for (let ly = y; ly < y + height; ly += 4) {
    lines.push(`<rect x="0" y="${ly}" width="${WIDTH}" height="1" fill="white" opacity="0.03"/>`);
  }
  return lines.join('');
}

function renderHeatmapRow(
  x: number,
  y: number,
  count: number,
  _maxCount: number,
  accent: string,
): string {
  const cellSize = 14;
  const gap = 3;
  const cells: string[] = [];
  const coolColor = '#1a1a4e';

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 1;
    const r = Math.round(lerp(parseInt(coolColor.slice(1, 3), 16), parseInt(accent.slice(1, 3), 16), t));
    const g = Math.round(lerp(parseInt(coolColor.slice(3, 5), 16), parseInt(accent.slice(3, 5), 16), t));
    const b = Math.round(lerp(parseInt(coolColor.slice(5, 7), 16), parseInt(accent.slice(5, 7), 16), t));
    const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    const cx = x + i * (cellSize + gap);
    cells.push(`<rect x="${cx}" y="${y}" width="${cellSize}" height="${cellSize}" rx="3" fill="${color}"/>`);
  }
  return cells.join('');
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function renderStackedBar(
  x: number,
  y: number,
  w: number,
  h: number,
  segments: Array<{ fraction: number; color: string }>,
): string {
  const parts: string[] = [];
  let offset = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const segW = Math.max(1, seg.fraction * w);
    const rx = i === 0 && i === segments.length - 1 ? h / 2
      : i === 0 ? `${h / 2} 0 0 ${h / 2}`
      : i === segments.length - 1 ? `0 ${h / 2} ${h / 2} 0`
      : '0';
    if (typeof rx === 'number') {
      parts.push(`<rect x="${x + offset}" y="${y}" width="${segW}" height="${h}" rx="${rx}" fill="${escapeXml(seg.color)}"/>`);
    } else {
      parts.push(`<rect x="${x + offset}" y="${y}" width="${segW}" height="${h}" fill="${escapeXml(seg.color)}"/>`);
    }
    offset += segW;
  }
  return parts.join('');
}

function renderRadialHeatRing(
  cx: number,
  cy: number,
  r: number,
  values24: number[],
  accent: string,
  dimColor: string,
): string {
  const parts: string[] = [];
  const maxVal = Math.max(...values24, 1);
  const strokeW = 20;
  const gapDeg = 2;
  const segDeg = (360 - 24 * gapDeg) / 24;

  for (let i = 0; i < 24; i++) {
    const startA = i * (segDeg + gapDeg) - 90;
    const endA = startA + segDeg;
    const t = values24[i]! / maxVal;
    const opacity = 0.15 + t * 0.85;
    const color = t > 0.3 ? accent : dimColor;
    const arcPath = describeArc(cx, cy, r, startA, endA);
    parts.push(`<path d="${arcPath}" fill="none" stroke="${escapeXml(color)}" stroke-width="${strokeW}" stroke-linecap="round" opacity="${opacity.toFixed(2)}"/>`);
  }
  return parts.join('');
}

function renderSpeedometer(
  cx: number,
  cy: number,
  r: number,
  value: number,
  theme: WrappedTheme,
): string {
  const parts: string[] = [];
  const startAngle = 135;
  const endAngle = 405;
  const totalSweep = endAngle - startAngle;
  const trackWidth = 20;

  // Track segments: red → yellow → green
  const trackSegments = [
    { end: 0.25, color: '#FF4757' },
    { end: 0.5, color: '#FFB347' },
    { end: 0.75, color: '#FFD700' },
    { end: 1.0, color: '#39FF14' },
  ];

  let prevEnd = 0;
  for (const seg of trackSegments) {
    const sA = startAngle + prevEnd * totalSweep;
    const eA = startAngle + seg.end * totalSweep;
    if (eA - sA < 0.5) { prevEnd = seg.end; continue; }
    const arcPath = describeArc(cx, cy, r, sA, eA);
    parts.push(`<path d="${arcPath}" fill="none" stroke="${escapeXml(seg.color)}" stroke-width="${trackWidth}" stroke-linecap="round" opacity="0.3"/>`);
    prevEnd = seg.end;
  }

  // Active arc
  if (value > 0) {
    const activeEnd = startAngle + Math.min(value, 1) * totalSweep;
    const activeColor = value >= 0.75 ? '#39FF14' : value >= 0.5 ? '#FFD700' : value >= 0.25 ? '#FFB347' : '#FF4757';
    const activePath = describeArc(cx, cy, r, startAngle, activeEnd);
    parts.push(`<path d="${activePath}" fill="none" stroke="${escapeXml(activeColor)}" stroke-width="${trackWidth}" stroke-linecap="round"/>`);
  }

  // Needle
  const needleAngle = startAngle + Math.min(value, 1) * totalSweep;
  const needleTip = polarToCartesian(cx, cy, r - 8, needleAngle);
  const needleBase1 = polarToCartesian(cx, cy, 6, needleAngle - 90);
  const needleBase2 = polarToCartesian(cx, cy, 6, needleAngle + 90);
  parts.push(`<path d="M${needleTip.x} ${needleTip.y} L${needleBase1.x} ${needleBase1.y} L${needleBase2.x} ${needleBase2.y} Z" fill="${escapeXml(theme.fg)}"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="8" fill="${escapeXml(theme.fg)}"/>`);

  return parts.join('');
}

function cacheGrade(hitRate: number): string {
  if (hitRate >= 0.9) return 'A';
  if (hitRate >= 0.75) return 'B';
  if (hitRate >= 0.5) return 'C';
  if (hitRate >= 0.25) return 'D';
  return 'F';
}

function renderLineChart(
  x: number,
  y: number,
  w: number,
  h: number,
  observed: number[],
  projected: number[],
  accent: string,
  theme: WrappedTheme,
): string {
  const parts: string[] = [];
  const all = [...observed, ...projected];
  const maxVal = Math.max(...all, 1);
  const totalPoints = all.length;
  if (totalPoints === 0) return '';

  const pointSpacing = w / Math.max(totalPoints - 1, 1);

  // Gradient fill under observed line
  const gradId = `line-fill-${x}-${y}`;
  parts.push(
    `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${escapeXml(accent)}" stop-opacity="0.3"/>` +
    `<stop offset="100%" stop-color="${escapeXml(accent)}" stop-opacity="0"/>` +
    `</linearGradient></defs>`,
  );

  // Build observed polygon fill
  if (observed.length > 1) {
    const polyPoints: string[] = [];
    polyPoints.push(`${x},${y + h}`);
    for (let i = 0; i < observed.length; i++) {
      const px = x + i * pointSpacing;
      const py = y + h - (observed[i]! / maxVal) * h;
      polyPoints.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    polyPoints.push(`${(x + (observed.length - 1) * pointSpacing).toFixed(1)},${y + h}`);
    parts.push(`<polygon points="${polyPoints.join(' ')}" fill="url(#${gradId})"/>`);
  }

  // Observed solid line
  if (observed.length > 1) {
    const pathParts: string[] = [];
    for (let i = 0; i < observed.length; i++) {
      const px = x + i * pointSpacing;
      const py = y + h - (observed[i]! / maxVal) * h;
      pathParts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`);
    }
    parts.push(`<path d="${pathParts.join(' ')}" fill="none" stroke="${escapeXml(accent)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  // Projected dashed line
  if (projected.length > 0) {
    const startIdx = observed.length - 1;
    const pathParts: string[] = [];
    // Start from last observed point
    if (observed.length > 0) {
      const px = x + startIdx * pointSpacing;
      const py = y + h - (observed[observed.length - 1]! / maxVal) * h;
      pathParts.push(`M${px.toFixed(1)} ${py.toFixed(1)}`);
    }
    for (let i = 0; i < projected.length; i++) {
      const px = x + (startIdx + 1 + i) * pointSpacing;
      const py = y + h - (projected[i]! / maxVal) * h;
      pathParts.push(`L${px.toFixed(1)} ${py.toFixed(1)}`);
    }
    parts.push(`<path d="${pathParts.join(' ')}" fill="none" stroke="${escapeXml(accent)}" stroke-width="2" stroke-dasharray="8,6" stroke-linecap="round" opacity="0.6"/>`);
  }

  // Dots on observed
  if (observed.length <= 31) {
    for (let i = 0; i < observed.length; i++) {
      const px = x + i * pointSpacing;
      const py = y + h - (observed[i]! / maxVal) * h;
      parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="${escapeXml(accent)}"/>`);
    }
  }

  // Callout at projection endpoint
  if (projected.length > 0) {
    const lastIdx = startIdx(observed.length, projected.length);
    const lastPx = x + lastIdx * pointSpacing;
    const lastPy = y + h - (projected[projected.length - 1]! / maxVal) * h;
    const labelText = formatCost(projected[projected.length - 1]!);
    const labelW = labelText.length * 10 + 20;
    const labelH = 28;
    const labelX = Math.min(lastPx - labelW / 2, x + w - labelW);
    const labelY = Math.max(lastPy - labelH - 10, y);
    parts.push(roundedRect(labelX, labelY, labelW, labelH, theme.cardBg, 6, { stroke: accent, strokeWidth: 1 }));
    parts.push(svgText(labelX + labelW / 2, labelY + 19, labelText, {
      fill: accent,
      size: 13,
      weight: 700,
      anchor: 'middle',
      family: MONO_FONT,
    }));
  }

  return parts.join('');
}

function startIdx(observedLen: number, _projectedLen: number): number {
  return observedLen - 1 + _projectedLen;
}

// ── Date formatting helper ───────────────────────────────────────────
function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return dateStr;
  const month = MONTH_NAMES[d.getUTCMonth()] ?? '';
  return `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ── Slide 1: Title Card ──────────────────────────────────────────────
function renderTitleSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 420;
  const parts: string[] = [];
  const accent = theme.slideAccents[0]!;

  // Background
  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  // Scanline texture
  parts.push(renderScanlines(0, height));

  // "Your AI Coding" in oversized type
  parts.push(svgText(INNER_PAD, 150, 'Your AI Coding', {
    fill: theme.fg,
    size: 56,
    weight: 800,
    family: DISPLAY_FONT,
  }));

  // "Wrapped" in accent
  parts.push(svgText(INNER_PAD, 224, 'Wrapped', {
    fill: accent,
    size: 64,
    weight: 800,
    family: DISPLAY_FONT,
  }));

  // Blinking cursor after "Wrapped"
  const cursorX = INNER_PAD + 330;
  parts.push(`<rect x="${cursorX}" y="190" width="4" height="40" rx="2" fill="${escapeXml(accent)}" opacity="0.8">`);
  parts.push(`<animate attributeName="opacity" values="0.8;0;0.8" dur="1.2s" repeatCount="indefinite"/>`);
  parts.push(`</rect>`);

  // "SEASON 2025" badge
  const badgeX = INNER_PAD;
  const badgeY = 70;
  const year = new Date().getFullYear();
  const badgeText = `SEASON ${year}`;
  parts.push(roundedRect(badgeX, badgeY, 160, 30, 'transparent', 6, { stroke: accent, strokeWidth: 1 }));
  parts.push(svgText(badgeX + 80, badgeY + 20, badgeText, {
    fill: accent,
    size: 12,
    weight: 700,
    anchor: 'middle',
    family: MONO_FONT,
    spacing: 2,
  }));

  // Date range
  const { since, until } = output.dateRange;
  const rangeText = `${formatDateLong(since)} \u2014 ${formatDateLong(until)}`;
  parts.push(svgText(INNER_PAD, 270, rangeText, {
    fill: theme.fgMuted,
    size: 18,
    weight: 500,
  }));

  // Watermark
  parts.push(svgText(INNER_PAD, 310, 'tokenleak', {
    fill: accent,
    size: 14,
    weight: 600,
    opacity: 0.5,
    family: MONO_FONT,
  }));

  return { svg: parts.join('\n'), height };
}

// ── Slide 2: Big Numbers ─────────────────────────────────────────────
function renderBigNumbersSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 440;
  const parts: string[] = [];
  const stats = output.aggregated;
  const accent = theme.slideAccents[1]!;

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  parts.push(sectionHeader(INNER_PAD, 55, 'THE BIG NUMBERS', theme));

  const contentW = WIDTH - INNER_PAD * 2;
  const colWidth = contentW / 3;

  const statItems = [
    { value: formatNumber(stats.totalTokens), label: 'total tokens', color: accent },
    { value: formatCost(stats.totalCost), label: 'total cost', color: ACCENT.amber },
    { value: `${stats.activeDays}`, label: 'active days', color: ACCENT.cyan },
  ];

  for (let i = 0; i < statItems.length; i++) {
    const item = statItems[i]!;
    const sx = INNER_PAD + i * colWidth;

    // Hairline rule between columns
    if (i > 0) {
      parts.push(`<line x1="${sx}" y1="90" x2="${sx}" y2="${height - 60}" stroke="${escapeXml(theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)')}" stroke-width="1"/>`);
    }

    // Giant monospace numeral
    parts.push(svgText(sx + colWidth / 2, 220, item.value, {
      fill: item.color,
      size: i === 0 ? 80 : 72,
      weight: 800,
      anchor: 'middle',
      family: MONO_FONT,
    }));

    // Unit label
    parts.push(svgText(sx + colWidth / 2, 260, item.label, {
      fill: theme.fgDim,
      size: 14,
      weight: 500,
      anchor: 'middle',
      family: DISPLAY_FONT,
    }));
  }

  return { svg: parts.join('\n'), height };
}

// ── Slide 3: Streak Story ────────────────────────────────────────────
function renderStreakSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 380;
  const parts: string[] = [];
  const stats = output.aggregated;
  const accent = theme.slideAccents[2]!;

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  parts.push(sectionHeader(INNER_PAD, 55, 'STREAK STORY', theme));

  const narrative = stats.longestStreak > 0
    ? `Your longest coding streak was ${stats.longestStreak} days`
    : 'Start your first coding streak!';
  parts.push(svgText(INNER_PAD, 110, narrative, {
    fill: theme.narrativeColor,
    size: 22,
    weight: 600,
  }));

  // Big streak number with glow
  parts.push(glowCircle(INNER_PAD + 80, 200, 80, accent, 0.06));
  parts.push(svgText(INNER_PAD, 220, `${stats.longestStreak}`, {
    fill: accent,
    size: 80,
    weight: 800,
    family: MONO_FONT,
  }));

  // Fire icon with simulated glow
  const fireX = INNER_PAD + 200;
  parts.push(glowCircle(fireX + 28, 185, 40, accent, 0.08));
  parts.push(svgIconFire(fireX, 160, 56, accent));

  // Current streak
  parts.push(svgText(INNER_PAD, 270, `Current streak: ${stats.currentStreak} days`, {
    fill: theme.fgMuted,
    size: 16,
    weight: 500,
  }));

  // Heatmap row
  const heatmapCount = Math.min(stats.longestStreak, 30);
  if (heatmapCount > 0) {
    parts.push(renderHeatmapRow(INNER_PAD, 310, heatmapCount, heatmapCount, accent));
    if (stats.longestStreak > 30) {
      const overflow = heatmapCount * (14 + 3) + 8;
      parts.push(svgText(INNER_PAD + overflow, 323, `+${stats.longestStreak - 30}`, {
        fill: accent,
        size: 12,
        weight: 600,
        family: MONO_FONT,
      }));
    }
  }

  return { svg: parts.join('\n'), height };
}

// ── Slide 4: Top Model ───────────────────────────────────────────────
function renderTopModelSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 420;
  const parts: string[] = [];
  const stats = output.aggregated;
  const topModels = stats.topModels.slice(0, 3);
  const accent = theme.slideAccents[3]!;

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  parts.push(sectionHeader(INNER_PAD, 55, 'YOUR TOP MODEL', theme));

  if (topModels.length === 0) {
    parts.push(svgText(INNER_PAD, 200, 'No model data available', {
      fill: theme.fgMuted,
      size: 20,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height };
  }

  const topModel = topModels[0]!;

  // Donut chart: thick-stroke, gapped segments, round caps
  const donutCx = WIDTH - 240;
  const donutCy = 220;
  const donutR = 100;
  const donutWidth = 28;
  const arcColors = [accent, ACCENT.purple, ACCENT.green, ACCENT.amber];

  // Radial glow behind chart
  parts.push(glowCircle(donutCx, donutCy, donutR + 30, accent, 0.05));

  // Background ring
  const ringBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  parts.push(`<circle cx="${donutCx}" cy="${donutCy}" r="${donutR}" fill="none" stroke="${ringBg}" stroke-width="${donutWidth}"/>`);

  // Model arcs with 3-degree gaps
  let arcStartAngle = 0;
  const gapDeg = 3;
  for (let i = 0; i < topModels.length; i++) {
    const model = topModels[i]!;
    const sweep = (model.percentage / 100) * 360;
    if (sweep < 1) continue;
    const adjustedSweep = Math.max(sweep - gapDeg, 1);
    const endAngle = arcStartAngle + adjustedSweep;
    const arcPath = describeArc(donutCx, donutCy, donutR, arcStartAngle, endAngle);
    parts.push(`<path d="${arcPath}" fill="none" stroke="${escapeXml(arcColors[i % arcColors.length]!)}" stroke-width="${donutWidth}" stroke-linecap="round"/>`);
    arcStartAngle += sweep;
  }

  // Model name centered in donut
  parts.push(svgText(donutCx, donutCy - 5, topModel.model, {
    fill: theme.fg,
    size: 16,
    weight: 700,
    anchor: 'middle',
    family: MONO_FONT,
  }));

  // Percentage below model name
  parts.push(svgText(donutCx, donutCy + 25, `${topModel.percentage.toFixed(0)}%`, {
    fill: accent,
    size: 28,
    weight: 800,
    anchor: 'middle',
    family: MONO_FONT,
  }));

  // Left side: model list with bars
  const barsY = 100;
  const barMaxWidth = 400;
  for (let i = 0; i < topModels.length; i++) {
    const model = topModels[i]!;
    const by = barsY + i * 80;
    parts.push(svgText(INNER_PAD, by + 20, `#${i + 1}`, {
      fill: arcColors[i % arcColors.length]!,
      size: 14,
      weight: 700,
      family: MONO_FONT,
    }));
    parts.push(svgText(INNER_PAD + 40, by + 20, model.model, {
      fill: theme.fg,
      size: 16,
      weight: 600,
    }));
    const trackBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
    parts.push(roundedRect(INNER_PAD + 40, by + 32, barMaxWidth, 14, trackBg, 7));
    const barW = Math.max(8, (model.percentage / 100) * barMaxWidth);
    parts.push(roundedRect(INNER_PAD + 40, by + 32, barW, 14, arcColors[i % arcColors.length]!, 7, { opacity: 0.8 }));
    parts.push(svgText(INNER_PAD + 40 + barMaxWidth + 16, by + 46, `${model.percentage.toFixed(0)}%`, {
      fill: theme.fgMuted,
      size: 13,
      weight: 600,
      family: MONO_FONT,
    }));
  }

  return { svg: parts.join('\n'), height };
}

// ── Slide 5: Provider Mix ────────────────────────────────────────────
function renderProviderMixSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const providers = output.providers;
  const height = Math.max(200, 200 + providers.length * 30);
  const parts: string[] = [];
  const accent = theme.slideAccents[4]!;

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  parts.push(sectionHeader(INNER_PAD, 55, 'PROVIDER MIX', theme));

  if (providers.length === 0) {
    parts.push(svgText(INNER_PAD, 130, 'No provider data', {
      fill: theme.fgMuted,
      size: 18,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height: 200 };
  }

  const totalTokens = providers.reduce((s, p) => s + p.totalTokens, 0);
  const topProvider = providers.reduce((a, b) => (a.totalTokens >= b.totalTokens ? a : b));
  const topPct = totalTokens > 0 ? ((topProvider.totalTokens / totalTokens) * 100).toFixed(0) : '0';

  parts.push(svgText(INNER_PAD, 100, `${topProvider.displayName} was your go-to (${topPct}%)`, {
    fill: theme.narrativeColor,
    size: 22,
    weight: 600,
  }));

  // Stacked bar
  const barX = INNER_PAD;
  const barY = 130;
  const barW = WIDTH - INNER_PAD * 2;
  const barH = 32;

  const segments = providers.map((p) => ({
    fraction: totalTokens > 0 ? p.totalTokens / totalTokens : 0,
    color: p.colors.primary,
  }));
  parts.push(renderStackedBar(barX, barY, barW, barH, segments));

  // Swatches + labels below
  let swatchX = INNER_PAD;
  const swatchY = barY + barH + 24;
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!;
    const pct = totalTokens > 0 ? ((p.totalTokens / totalTokens) * 100).toFixed(0) : '0';
    parts.push(`<rect x="${swatchX}" y="${swatchY}" width="12" height="12" rx="3" fill="${escapeXml(p.colors.primary)}"/>`);
    parts.push(svgText(swatchX + 18, swatchY + 11, `${p.displayName} ${pct}%`, {
      fill: theme.fgMuted,
      size: 13,
      weight: 500,
    }));
    swatchX += p.displayName.length * 8 + 70;
  }

  return { svg: parts.join('\n'), height };
}

// ── Slide 6: Day of Week ─────────────────────────────────────────────
function renderDayOfWeekSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 400;
  const parts: string[] = [];
  const dow = output.aggregated.dayOfWeek;
  const accent = theme.slideAccents[5]!;

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  parts.push(sectionHeader(INNER_PAD, 55, 'CODING DAYS', theme));

  if (dow.length === 0) {
    parts.push(svgText(INNER_PAD, 200, 'No day-of-week data', {
      fill: theme.fgMuted,
      size: 18,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height };
  }

  const peak = dow.reduce((a, b) => (a.tokens >= b.tokens ? a : b));
  const peakName = DAY_NAMES[peak.day] ?? 'Unknown';
  const maxTokens = Math.max(...dow.map((d) => d.tokens), 1);

  parts.push(svgText(INNER_PAD, 100, `${peakName}s are your power day`, {
    fill: theme.narrativeColor,
    size: 22,
    weight: 600,
  }));

  // Dotted grid lines
  const chartX = INNER_PAD + 30;
  const chartY = 130;
  const barAreaWidth = WIDTH - INNER_PAD * 2 - 60;
  const barWidth = 24;
  const barGap = (barAreaWidth - 7 * barWidth) / 6;
  const barMaxHeight = 190;

  for (const pct of [0.25, 0.5, 0.75, 1.0]) {
    const gy = chartY + barMaxHeight - pct * barMaxHeight;
    parts.push(`<line x1="${chartX}" y1="${gy}" x2="${chartX + barAreaWidth}" y2="${gy}" stroke="${escapeXml(theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)')}" stroke-width="1" stroke-dasharray="4,4"/>`);
  }

  for (let i = 0; i < 7 && i < dow.length; i++) {
    const entry = dow[i]!;
    const bx = chartX + i * (barWidth + barGap);
    const ratio = maxTokens > 0 ? entry.tokens / maxTokens : 0;
    const barH = Math.max(4, ratio * barMaxHeight);
    const by = chartY + barMaxHeight - barH;
    const isPeak = entry.day === peak.day;

    // Peak bar: glow behind
    if (isPeak) {
      parts.push(`<rect x="${bx - 8}" y="${by - 4}" width="${barWidth + 16}" height="${barH + 8}" rx="14" fill="${escapeXml(accent)}" opacity="0.1"/>`);
    }

    const barColor = isPeak ? accent : (theme.mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)');
    parts.push(roundedRect(bx, by, barWidth, barH, barColor, 6));

    // Day label
    const dayLabel = DAY_SHORT[i] ?? '';
    parts.push(svgText(bx + barWidth / 2, chartY + barMaxHeight + 24, dayLabel, {
      fill: isPeak ? accent : theme.fgMuted,
      size: 13,
      weight: isPeak ? 700 : 500,
      anchor: 'middle',
      family: MONO_FONT,
    }));

    // Token count above peak bar
    if (isPeak) {
      parts.push(svgText(bx + barWidth / 2, by - 10, formatNumber(entry.tokens), {
        fill: accent,
        size: 13,
        weight: 700,
        anchor: 'middle',
        family: MONO_FONT,
      }));
    }
  }

  return { svg: parts.join('\n'), height };
}

// ── Slide 7: Time of Day ─────────────────────────────────────────────
function renderTimeOfDaySlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const more = output.more;
  if (!more?.hourOfDay) return { svg: '', height: 0 };

  const hourOfDay = more.hourOfDay;
  const totalTokens = hourOfDay.reduce((s, e) => s + e.tokens, 0);
  if (totalTokens === 0) return { svg: '', height: 0 };

  const height = 420;
  const parts: string[] = [];
  const accent = theme.slideAccents[6]!;

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  parts.push(sectionHeader(INNER_PAD, 55, 'WHEN YOU CODE', theme));

  // Time periods
  const morning = hourOfDay.filter((e) => e.hour >= 6 && e.hour < 12).reduce((s, e) => s + e.tokens, 0);
  const afternoon = hourOfDay.filter((e) => e.hour >= 12 && e.hour < 18).reduce((s, e) => s + e.tokens, 0);
  const evening = hourOfDay.filter((e) => e.hour >= 18 && e.hour < 22).reduce((s, e) => s + e.tokens, 0);
  const night = hourOfDay.filter((e) => e.hour >= 22 || e.hour < 6).reduce((s, e) => s + e.tokens, 0);

  const periods = [
    { label: 'Morning', tokens: morning },
    { label: 'Afternoon', tokens: afternoon },
    { label: 'Evening', tokens: evening },
    { label: 'Night', tokens: night },
  ];

  const dominant = periods.reduce((a, b) => (a.tokens >= b.tokens ? a : b));
  const dominantPct = totalTokens > 0 ? ((dominant.tokens / totalTokens) * 100).toFixed(0) : '0';

  let narrativeText = '';
  if (dominant.label === 'Night') {
    narrativeText = `You're a night owl -- ${dominantPct}% of tokens between 10pm-6am`;
  } else if (dominant.label === 'Evening') {
    narrativeText = `You're an evening coder -- ${dominantPct}% between 6-10pm`;
  } else if (dominant.label === 'Morning') {
    narrativeText = `You're an early bird -- ${dominantPct}% before noon`;
  } else {
    narrativeText = `Afternoons are your peak -- ${dominantPct}% from 12-6pm`;
  }
  parts.push(svgText(INNER_PAD, 100, narrativeText, {
    fill: theme.narrativeColor,
    size: 22,
    weight: 600,
  }));

  // Radial heat ring
  const ringCx = WIDTH / 2;
  const ringCy = 270;
  const ringR = 110;
  const dimColor = theme.mode === 'dark' ? '#1a1a2e' : '#d1d5db';
  const values24 = hourOfDay.map((e) => e.tokens);
  parts.push(renderRadialHeatRing(ringCx, ringCy, ringR, values24, accent, dimColor));

  // Hour markers
  const markerLabels = [
    { hour: 0, label: '12am', iconFn: svgIconMoon },
    { hour: 6, label: '6am', iconFn: svgIconSun },
    { hour: 12, label: '12pm', iconFn: svgIconSun },
    { hour: 18, label: '6pm', iconFn: svgIconMoon },
  ];
  for (const mk of markerLabels) {
    const angleDeg = (mk.hour / 24) * 360 - 90;
    const pos = polarToCartesian(ringCx, ringCy, ringR + 30, angleDeg);
    parts.push(mk.iconFn(pos.x - 8, pos.y - 8, 16, theme.fgMuted));
  }

  // Center: dominant period text
  parts.push(svgText(ringCx, ringCy - 5, dominant.label, {
    fill: theme.fg,
    size: 18,
    weight: 700,
    anchor: 'middle',
    family: MONO_FONT,
  }));
  parts.push(svgText(ringCx, ringCy + 18, `${dominantPct}%`, {
    fill: accent,
    size: 24,
    weight: 800,
    anchor: 'middle',
    family: MONO_FONT,
  }));

  return { svg: parts.join('\n'), height };
}

// ── Slide 8: Cache Efficiency ────────────────────────────────────────
function renderCacheSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 380;
  const parts: string[] = [];
  const stats = output.aggregated;
  const accent = theme.slideAccents[7]!;

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  parts.push(sectionHeader(INNER_PAD, 55, 'CACHE EFFICIENCY', theme));

  const hitRate = stats.cacheHitRate;
  const hitPct = (hitRate * 100).toFixed(1);
  const grade = cacheGrade(hitRate);

  // Speedometer gauge
  const gaugeCx = WIDTH - 280;
  const gaugeCy = 210;
  const gaugeR = 90;
  parts.push(renderSpeedometer(gaugeCx, gaugeCy, gaugeR, hitRate, theme));

  // Letter grade beside gauge
  parts.push(svgText(gaugeCx, gaugeCy + 55, grade, {
    fill: accent,
    size: 48,
    weight: 800,
    anchor: 'middle',
    family: MONO_FONT,
  }));

  // Left side: narrative + stats
  parts.push(svgText(INNER_PAD, 120, `${hitPct}% Cache Hit Rate`, {
    fill: theme.narrativeColor,
    size: 24,
    weight: 600,
  }));

  // Big percentage
  parts.push(svgText(INNER_PAD, 210, `${hitPct}%`, {
    fill: accent,
    size: 64,
    weight: 800,
    family: MONO_FONT,
  }));

  const cacheEcon = output.more?.cacheEconomics;
  if (cacheEcon) {
    parts.push(svgText(INNER_PAD, 260, `${formatNumber(cacheEcon.readTokens)} cache reads`, {
      fill: theme.fgMuted,
      size: 16,
      weight: 500,
    }));
    parts.push(svgText(INNER_PAD, 290, `${formatNumber(cacheEcon.writeTokens)} cache writes`, {
      fill: theme.fgMuted,
      size: 16,
      weight: 500,
    }));
    if (cacheEcon.reuseRatio !== null && Number.isFinite(cacheEcon.reuseRatio)) {
      parts.push(svgText(INNER_PAD, 320, `${cacheEcon.reuseRatio.toFixed(1)}x reuse ratio`, {
        fill: accent,
        size: 16,
        weight: 600,
      }));
    }
  }

  return { svg: parts.join('\n'), height };
}

// ── Slide 9: Peak Day Spotlight ──────────────────────────────────────
function renderPeakDaySlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 340;
  const parts: string[] = [];
  const stats = output.aggregated;
  const accent = theme.slideAccents[8]!;

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  parts.push(sectionHeader(INNER_PAD, 55, 'PEAK DAY', theme));

  if (!stats.peakDay) {
    parts.push(svgText(INNER_PAD, 180, 'No usage data recorded yet', {
      fill: theme.fgMuted,
      size: 20,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height };
  }

  // Decorative rule above headline
  parts.push(`<rect x="${INNER_PAD}" y="85" width="${WIDTH - INNER_PAD * 2}" height="3" rx="1.5" fill="${escapeXml(accent)}"/>`);

  // Date in massive condensed monospace - newspaper headline
  const formattedDate = formatDateLong(stats.peakDay.date);
  parts.push(svgText(INNER_PAD, 150, formattedDate.toUpperCase(), {
    fill: theme.fg,
    size: 48,
    weight: 800,
    family: MONO_FONT,
  }));

  // Decorative rule below headline
  parts.push(`<rect x="${INNER_PAD}" y="170" width="${WIDTH - INNER_PAD * 2}" height="3" rx="1.5" fill="${escapeXml(accent)}"/>`);

  // Token count as subheadline
  parts.push(svgText(INNER_PAD, 230, formatNumber(stats.peakDay.tokens), {
    fill: accent,
    size: 64,
    weight: 800,
    family: MONO_FONT,
  }));
  parts.push(svgText(INNER_PAD, 265, 'tokens in a single day', {
    fill: theme.fgMuted,
    size: 16,
    weight: 500,
  }));

  return { svg: parts.join('\n'), height };
}

// ── Slide 10: Achievements ───────────────────────────────────────────
function renderAchievementsSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const achievements = computeAchievements(output);
  const rows = Math.ceil(achievements.length / 3);
  const rowHeight = 110;
  const height = Math.max(240, 100 + rows * rowHeight + 40);
  const parts: string[] = [];

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  parts.push(sectionHeader(INNER_PAD, 55, 'ACHIEVEMENTS', theme));

  if (achievements.length === 0) {
    parts.push(svgText(INNER_PAD, 150, 'Keep coding to unlock achievements!', {
      fill: theme.fgMuted,
      size: 18,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height: 240 };
  }

  // 3-column grid
  const colCount = 3;
  const gap = 20;
  const colWidth = (WIDTH - INNER_PAD * 2 - (colCount - 1) * gap) / colCount;

  for (let i = 0; i < achievements.length; i++) {
    const a = achievements[i]!;
    const col = i % colCount;
    const row = Math.floor(i / colCount);
    const ax = INNER_PAD + col * (colWidth + gap);
    const ay = 90 + row * rowHeight;

    // Dark card
    parts.push(roundedRect(ax, ay, colWidth, 90, theme.cardBg, 12));

    // Icon
    parts.push(renderIcon(a.icon, ax + 16, ay + 20, 32, a.color));

    // Title
    parts.push(svgText(ax + 58, ay + 35, a.title, {
      fill: theme.fg,
      size: 15,
      weight: 700,
    }));

    // Subtitle
    parts.push(svgText(ax + 58, ay + 58, a.subtitle, {
      fill: theme.fgMuted,
      size: 12,
      weight: 500,
    }));
  }

  return { svg: parts.join('\n'), height };
}

// ── Slide 11: Monthly Burn Projection ────────────────────────────────
function renderMonthlyBurnSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 360;
  const parts: string[] = [];
  const accent = theme.slideAccents[10]!;

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  parts.push(sectionHeader(INNER_PAD, 55, 'MONTHLY PROJECTION', theme));

  const burn = output.more?.monthlyBurn;
  if (!burn) {
    const avgDailyCost = output.aggregated.averageDailyCost;
    const projected = avgDailyCost * 30;
    parts.push(svgText(INNER_PAD, 120, 'At this rate, you will spend about', {
      fill: theme.narrativeColor,
      size: 22,
      weight: 500,
    }));
    parts.push(svgText(INNER_PAD, 185, formatCost(projected), {
      fill: accent,
      size: 64,
      weight: 800,
      family: MONO_FONT,
    }));
    parts.push(svgText(INNER_PAD, 220, 'per month', {
      fill: theme.fgMuted,
      size: 16,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height };
  }

  parts.push(svgText(INNER_PAD, 100, 'At this rate, you will spend', {
    fill: theme.narrativeColor,
    size: 22,
    weight: 500,
  }));

  // Build line chart data
  const observedDays = burn.observedDays;
  const calendarDays = burn.calendarDays;
  const dailyCost = observedDays > 0 ? burn.projectedCost / calendarDays : 0;

  // Generate cumulative cost data
  const observed: number[] = [];
  for (let d = 0; d < observedDays; d++) {
    observed.push(dailyCost * (d + 1));
  }
  const projected: number[] = [];
  for (let d = observedDays; d < calendarDays; d++) {
    projected.push(dailyCost * (d + 1));
  }

  // Line chart
  const chartX = INNER_PAD;
  const chartY = 130;
  const chartW = WIDTH - INNER_PAD * 2;
  const chartH = 160;

  parts.push(renderLineChart(chartX, chartY, chartW, chartH, observed, projected, accent, theme));

  // Label
  parts.push(svgText(INNER_PAD, chartY + chartH + 30, `Based on ${burn.observedDays} of ${burn.calendarDays} days \u2014 projected: ${formatCost(burn.projectedCost)}`, {
    fill: theme.fgMuted,
    size: 13,
    weight: 500,
  }));

  return { svg: parts.join('\n'), height };
}

// ── Slide 12: Footer ─────────────────────────────────────────────────
function renderFooterSlide(
  _output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 140;
  const parts: string[] = [];

  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="${escapeXml(theme.bg)}"/>`);

  // Gradient top border cycling through accent colors
  const gradId = 'footer-grad';
  parts.push(
    `<defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">` +
    `<stop offset="0%" stop-color="${escapeXml(ACCENT.cyan)}"/>` +
    `<stop offset="25%" stop-color="${escapeXml(ACCENT.green)}"/>` +
    `<stop offset="50%" stop-color="${escapeXml(ACCENT.purple)}"/>` +
    `<stop offset="75%" stop-color="${escapeXml(ACCENT.amber)}"/>` +
    `<stop offset="100%" stop-color="${escapeXml(ACCENT.coral)}"/>` +
    `</linearGradient></defs>`,
  );
  parts.push(`<rect x="0" y="0" width="${WIDTH}" height="2" fill="url(#${gradId})"/>`);

  parts.push(svgText(INNER_PAD, 55, 'Generated by tokenleak', {
    fill: theme.fgMuted,
    size: 14,
    weight: 600,
    family: MONO_FONT,
  }));

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  parts.push(svgText(INNER_PAD, 80, now, {
    fill: theme.fgDim,
    size: 12,
    weight: 400,
    family: MONO_FONT,
    opacity: 0.6,
  }));

  parts.push(svgText(WIDTH - INNER_PAD, 60, 'tokenleak', {
    fill: theme.slideAccents[11]!,
    size: 18,
    weight: 700,
    anchor: 'end',
    opacity: 0.3,
    family: MONO_FONT,
  }));

  return { svg: parts.join('\n'), height };
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

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${totalHeight}" viewBox="0 0 ${WIDTH} ${totalHeight}" shape-rendering="geometricPrecision" text-rendering="optimizeLegibility" color-rendering="optimizeQuality">`,
    `<rect width="${WIDTH}" height="${totalHeight}" fill="${escapeXml(theme.bg)}"/>`,
    ...stackedSections,
    '</svg>',
  ].join('\n');
}
