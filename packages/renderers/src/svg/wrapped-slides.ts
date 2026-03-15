import type { TokenleakOutput } from '@tokenleak/core';
import { escapeXml, formatNumber, formatCost } from './utils';
import { getTheme } from './theme';
import type { SvgTheme } from './theme';

// ── Constants ────────────────────────────────────────────────────────
const WIDTH = 1200;
const INNER_PAD = 80;
const FONT_FAMILY =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO_FONT =
  "'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace";

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Theme extension for wrapped ──────────────────────────────────────
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
        ['#120828', '#0a1628'],
        ['#0a1628', '#0d1b2a'],
        ['#1a0e00', '#0d1117'],
        ['#0a1a2e', '#0d1117'],
        ['#0d1117', '#0f1520'],
        ['#0a1628', '#0d1117'],
        ['#180830', '#0d1117'],
        ['#001a0d', '#0d1117'],
        ['#1a1500', '#0d1117'],
        ['#120828', '#0a1628'],
        ['#0a1628', '#0d1117'],
        ['#09090b', '#09090b'],
      ],
      heroAccent: '#a78bfa',
      warmAccent: '#f59e0b',
      coolAccent: '#38bdf8',
      greenAccent: '#34d399',
      goldAccent: '#fbbf24',
      purpleAccent: '#c084fc',
      narrativeColor: '#cbd5e1',
      subtitleColor: '#94a3b8',
    };
  }
  return {
    base,
    mode,
    sectionBgs: [
      ['#ede9fe', '#e0e7ff'],
      ['#e0e7ff', '#eff6ff'],
      ['#fef3c7', '#fffbeb'],
      ['#dbeafe', '#eff6ff'],
      ['#f8fafc', '#f1f5f9'],
      ['#dbeafe', '#eff6ff'],
      ['#ede9fe', '#f5f3ff'],
      ['#d1fae5', '#ecfdf5'],
      ['#fef9c3', '#fefce8'],
      ['#ede9fe', '#e0e7ff'],
      ['#dbeafe', '#eff6ff'],
      ['#f8fafc', '#f8fafc'],
    ],
    heroAccent: '#7c3aed',
    warmAccent: '#d97706',
    coolAccent: '#2563eb',
    greenAccent: '#059669',
    goldAccent: '#b45309',
    purpleAccent: '#7c3aed',
    narrativeColor: '#334155',
    subtitleColor: '#64748b',
  };
}

// ── Section result type ──────────────────────────────────────────────
interface SlideResult {
  svg: string;
  height: number;
}

// ── SVG icon shapes (replacing emoji) ────────────────────────────────
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
  // Rays
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

// Map icon names to SVG renderers
type IconName = 'fire' | 'star' | 'circle' | 'diamond' | 'bolt' | 'trophy' |
  'target' | 'mountain' | 'palette' | 'calendar' | 'moon' | 'sun' | 'rocket';

function renderIcon(name: IconName, x: number, y: number, size: number, color: string): string {
  const fns: Record<IconName, (x: number, y: number, s: number, c: string) => string> = {
    fire: svgIconFire,
    star: svgIconStar,
    circle: svgIconCircle,
    diamond: svgIconDiamond,
    bolt: svgIconBolt,
    trophy: svgIconTrophy,
    target: svgIconTarget,
    mountain: svgIconMountain,
    palette: svgIconPalette,
    calendar: svgIconCalendar,
    moon: svgIconMoon,
    sun: svgIconSun,
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

  // Fallbacks if fewer than 3
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
    // Guaranteed fallback so there's always at least one
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
  y: number,
  height: number,
  gradColors: [string, string],
  gradId: string,
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
    `font-family="${escapeXml(opts.family ?? FONT_FAMILY)}"`,
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
  const gradColors = theme.sectionBgs[0] ?? ['#120828', '#0a1628'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'title-bg'));

  // Decorative glow circles
  const glowColor = theme.mode === 'dark' ? theme.purpleAccent : '#7c3aed';
  parts.push(
    `<circle cx="200" cy="210" r="200" fill="${escapeXml(glowColor)}" opacity="0.04"/>`,
    `<circle cx="1000" cy="150" r="160" fill="${escapeXml(theme.coolAccent)}" opacity="0.03"/>`,
  );

  // Decorative top accent bar
  parts.push(
    `<rect x="${INNER_PAD}" y="50" width="60" height="4" rx="2" fill="${escapeXml(theme.heroAccent)}" opacity="0.6"/>`,
  );

  // Main title
  const titleColor = theme.mode === 'dark' ? '#f1f5f9' : '#1e1b4b';
  parts.push(svgText(INNER_PAD, 130, 'Your AI Coding', {
    fill: titleColor,
    size: 56,
    weight: 800,
  }));
  parts.push(svgText(INNER_PAD, 198, 'Wrapped', {
    fill: theme.heroAccent,
    size: 64,
    weight: 800,
  }));

  // Date range
  const { since, until } = output.dateRange;
  const rangeText = `${formatDateLong(since)} \u2014 ${formatDateLong(until)}`;
  parts.push(svgText(INNER_PAD, 250, rangeText, {
    fill: theme.subtitleColor,
    size: 18,
    weight: 500,
  }));

  parts.push(svgText(INNER_PAD, 290, 'tokenleak', {
    fill: theme.heroAccent,
    size: 16,
    weight: 600,
    opacity: 0.7,
  }));

  // Decorative bottom line
  parts.push(
    `<rect x="${INNER_PAD}" y="${height - 40}" width="100" height="3" rx="1.5" fill="${escapeXml(theme.heroAccent)}" opacity="0.3"/>`,
  );

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
  const gradColors = theme.sectionBgs[1] ?? ['#0a1628', '#0d1b2a'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'bignums-bg'));

  parts.push(svgText(INNER_PAD, 60, 'THE BIG NUMBERS', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 700,
    spacing: 3,
  }));

  // Hero: Total tokens
  parts.push(svgText(INNER_PAD, 150, formatNumber(stats.totalTokens), {
    fill: theme.mode === 'dark' ? '#f8fafc' : '#0f172a',
    size: 80,
    weight: 800,
  }));
  parts.push(svgText(INNER_PAD, 180, 'total tokens', {
    fill: theme.subtitleColor,
    size: 20,
    weight: 500,
  }));

  // Grid of supporting stats
  const gridY = 230;
  const colWidth = (WIDTH - INNER_PAD * 2) / 3;

  const supportStats = [
    { value: formatCost(stats.totalCost), label: 'Total Cost', accent: true },
    { value: `${stats.activeDays}`, label: 'Active Days', accent: false },
    { value: `${stats.totalDays}`, label: 'Total Days', accent: false },
  ];

  for (let i = 0; i < supportStats.length; i++) {
    const sx = INNER_PAD + i * colWidth;
    const stat = supportStats[i]!;
    const cardBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
    parts.push(roundedRect(sx, gridY, colWidth - 24, 140, cardBg, 16));
    parts.push(svgText(sx + 24, gridY + 60, stat.value, {
      fill: stat.accent ? theme.greenAccent : (theme.mode === 'dark' ? '#e2e8f0' : '#1e293b'),
      size: 42,
      weight: 700,
    }));
    parts.push(svgText(sx + 24, gridY + 95, stat.label, {
      fill: theme.subtitleColor,
      size: 14,
      weight: 600,
      spacing: 1,
    }));
  }

  return { svg: parts.join('\n'), height };
}

// ── Slide 3: Streak Story ────────────────────────────────────────────
function renderStreakSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 340;
  const parts: string[] = [];
  const stats = output.aggregated;
  const gradColors = theme.sectionBgs[2] ?? ['#1a0e00', '#0d1117'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'streak-bg'));

  // Warm glow
  parts.push(
    `<circle cx="${WIDTH - 180}" cy="170" r="120" fill="${escapeXml(theme.warmAccent)}" opacity="0.05"/>`,
  );

  parts.push(svgText(INNER_PAD, 55, 'STREAK STORY', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 700,
    spacing: 3,
  }));

  const narrative = stats.longestStreak > 0
    ? `Your longest coding streak was ${stats.longestStreak} days`
    : 'Start your first coding streak!';
  parts.push(svgText(INNER_PAD, 120, narrative, {
    fill: theme.narrativeColor,
    size: 24,
    weight: 600,
  }));

  // Big streak number
  parts.push(svgText(INNER_PAD, 210, `${stats.longestStreak}`, {
    fill: theme.warmAccent,
    size: 72,
    weight: 800,
  }));

  // Fire icon beside the number
  const fireX = INNER_PAD + 160;
  parts.push(svgIconFire(fireX, 155, 56, theme.warmAccent));

  // Current streak
  parts.push(svgText(INNER_PAD, 270, `Current streak: ${stats.currentStreak} days`, {
    fill: theme.subtitleColor,
    size: 16,
    weight: 500,
  }));

  // Streak dots
  const dotsToShow = Math.min(stats.longestStreak, 30);
  const dotSize = 10;
  const dotGap = 6;
  const dotsY = 300;
  for (let i = 0; i < dotsToShow; i++) {
    const dx = INNER_PAD + i * (dotSize + dotGap);
    const opacity = 0.3 + (i / Math.max(dotsToShow, 1)) * 0.7;
    parts.push(
      `<rect x="${dx}" y="${dotsY}" width="${dotSize}" height="${dotSize}" rx="3" fill="${escapeXml(theme.warmAccent)}" opacity="${opacity.toFixed(2)}"/>`,
    );
  }
  if (stats.longestStreak > 30) {
    parts.push(svgText(INNER_PAD + 30 * (dotSize + dotGap) + 8, dotsY + 9, `+${stats.longestStreak - 30}`, {
      fill: theme.warmAccent,
      size: 11,
      weight: 600,
    }));
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
  const gradColors = theme.sectionBgs[3] ?? ['#0a1a2e', '#0d1117'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'model-bg'));

  parts.push(svgText(INNER_PAD, 55, 'YOUR TOP MODEL', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 700,
    spacing: 3,
  }));

  if (topModels.length === 0) {
    parts.push(svgText(INNER_PAD, 200, 'No model data available', {
      fill: theme.subtitleColor,
      size: 20,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height };
  }

  const topModel = topModels[0]!;

  // Donut chart on the right
  const donutCx = WIDTH - 220;
  const donutCy = 200;
  const donutR = 100;
  const donutWidth = 24;
  const arcColors = [theme.coolAccent, theme.purpleAccent, theme.greenAccent, theme.warmAccent];

  // Background ring
  const ringBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  parts.push(
    `<circle cx="${donutCx}" cy="${donutCy}" r="${donutR}" fill="none" stroke="${ringBg}" stroke-width="${donutWidth}"/>`,
  );

  // Model arcs
  let startAngle = 0;
  for (let i = 0; i < topModels.length; i++) {
    const model = topModels[i]!;
    const sweep = (model.percentage / 100) * 360;
    if (sweep < 0.5) continue;
    const endAngle = startAngle + sweep;
    const clampedEnd = sweep >= 359.5 ? startAngle + 359.5 : endAngle;
    const arcPath = describeArc(donutCx, donutCy, donutR, startAngle, clampedEnd);
    parts.push(
      `<path d="${arcPath}" fill="none" stroke="${escapeXml(arcColors[i % arcColors.length]!)}" stroke-width="${donutWidth}" stroke-linecap="round"/>`,
    );
    startAngle = endAngle;
  }

  // Percentage in center
  parts.push(svgText(donutCx, donutCy + 12, `${topModel.percentage.toFixed(0)}%`, {
    fill: theme.mode === 'dark' ? '#f8fafc' : '#0f172a',
    size: 32,
    weight: 800,
    anchor: 'middle',
  }));

  // Top model name
  parts.push(svgText(INNER_PAD, 130, topModel.model, {
    fill: theme.coolAccent,
    size: 32,
    weight: 700,
  }));
  parts.push(svgText(INNER_PAD, 165, `${topModel.percentage.toFixed(0)}% of all tokens`, {
    fill: theme.subtitleColor,
    size: 16,
    weight: 500,
  }));

  // Model bars
  const barsY = 210;
  const barMaxWidth = 450;
  for (let i = 0; i < topModels.length; i++) {
    const model = topModels[i]!;
    const by = barsY + i * 56;
    parts.push(svgText(INNER_PAD, by + 20, `#${i + 1}`, {
      fill: arcColors[i % arcColors.length]!,
      size: 14,
      weight: 700,
    }));
    parts.push(svgText(INNER_PAD + 40, by + 20, model.model, {
      fill: theme.mode === 'dark' ? '#e2e8f0' : '#1e293b',
      size: 15,
      weight: 600,
    }));
    const trackBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
    parts.push(roundedRect(INNER_PAD + 40, by + 30, barMaxWidth, 12, trackBg, 6));
    const barW = Math.max(8, (model.percentage / 100) * barMaxWidth);
    parts.push(roundedRect(INNER_PAD + 40, by + 30, barW, 12, arcColors[i % arcColors.length]!, 6, { opacity: 0.8 }));
    parts.push(svgText(INNER_PAD + 40 + barMaxWidth + 16, by + 42, `${model.percentage.toFixed(0)}%`, {
      fill: theme.subtitleColor,
      size: 13,
      weight: 600,
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
  const baseHeight = 200;
  const perProviderHeight = 70;
  const height = Math.max(baseHeight, 130 + providers.length * perProviderHeight);
  const parts: string[] = [];
  const gradColors = theme.sectionBgs[4] ?? ['#0d1117', '#0f1520'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'provider-bg'));

  parts.push(svgText(INNER_PAD, 55, 'PROVIDER MIX', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 700,
    spacing: 3,
  }));

  if (providers.length === 0) {
    parts.push(svgText(INNER_PAD, 130, 'No provider data', {
      fill: theme.subtitleColor,
      size: 18,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height: baseHeight };
  }

  const totalTokens = providers.reduce((s, p) => s + p.totalTokens, 0);
  const topProvider = providers.reduce((a, b) => (a.totalTokens >= b.totalTokens ? a : b));
  const topPct = totalTokens > 0 ? ((topProvider.totalTokens / totalTokens) * 100).toFixed(0) : '0';

  parts.push(svgText(INNER_PAD, 100, `${topProvider.displayName} was your go-to (${topPct}%)`, {
    fill: theme.narrativeColor,
    size: 22,
    weight: 600,
  }));

  const barMaxWidth = WIDTH - INNER_PAD * 2 - 200;
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!;
    const py = 130 + i * perProviderHeight;
    const pct = totalTokens > 0 ? (p.totalTokens / totalTokens) * 100 : 0;

    parts.push(`<circle cx="${INNER_PAD + 8}" cy="${py + 18}" r="8" fill="${escapeXml(p.colors.primary)}"/>`);
    parts.push(svgText(INNER_PAD + 28, py + 23, p.displayName, {
      fill: theme.mode === 'dark' ? '#e2e8f0' : '#1e293b',
      size: 16,
      weight: 600,
    }));
    parts.push(svgText(WIDTH - INNER_PAD, py + 23, `${pct.toFixed(0)}%`, {
      fill: theme.subtitleColor,
      size: 15,
      weight: 700,
      anchor: 'end',
    }));
    const trackBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
    parts.push(roundedRect(INNER_PAD + 28, py + 36, barMaxWidth, 14, trackBg, 7));
    const barW = Math.max(8, (pct / 100) * barMaxWidth);
    parts.push(roundedRect(INNER_PAD + 28, py + 36, barW, 14, p.colors.primary, 7, { opacity: 0.75 }));
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
  const gradColors = theme.sectionBgs[5] ?? ['#0a1628', '#0d1117'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'dow-bg'));

  parts.push(svgText(INNER_PAD, 55, 'CODING DAYS', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 700,
    spacing: 3,
  }));

  if (dow.length === 0) {
    parts.push(svgText(INNER_PAD, 200, 'No day-of-week data', {
      fill: theme.subtitleColor,
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

  const chartX = INNER_PAD;
  const chartY = 140;
  const barAreaWidth = WIDTH - INNER_PAD * 2;
  const barWidth = Math.floor((barAreaWidth - 6 * 20) / 7);
  const barMaxHeight = 180;

  for (let i = 0; i < 7 && i < dow.length; i++) {
    const entry = dow[i]!;
    const bx = chartX + i * (barWidth + 20);
    const ratio = maxTokens > 0 ? entry.tokens / maxTokens : 0;
    const barH = Math.max(8, ratio * barMaxHeight);
    const by = chartY + barMaxHeight - barH;
    const isPeak = entry.day === peak.day;

    const barColor = isPeak ? theme.coolAccent : (theme.mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)');
    parts.push(roundedRect(bx, by, barWidth, barH, barColor, 8, { opacity: isPeak ? 1 : 0.6 }));

    if (isPeak) {
      parts.push(
        `<rect x="${bx - 4}" y="${by - 4}" width="${barWidth + 8}" height="${barH + 8}" rx="10" fill="${escapeXml(theme.coolAccent)}" opacity="0.12"/>`,
      );
    }

    const dayLabel = DAY_SHORT[i] ?? '';
    parts.push(svgText(bx + barWidth / 2, chartY + barMaxHeight + 24, dayLabel, {
      fill: isPeak ? theme.coolAccent : theme.subtitleColor,
      size: 13,
      weight: isPeak ? 700 : 500,
      anchor: 'middle',
    }));

    if (isPeak) {
      parts.push(svgText(bx + barWidth / 2, by - 12, formatNumber(entry.tokens), {
        fill: theme.coolAccent,
        size: 13,
        weight: 700,
        anchor: 'middle',
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

  const height = 400;
  const parts: string[] = [];
  const gradColors = theme.sectionBgs[6] ?? ['#180830', '#0d1117'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'tod-bg'));

  parts.push(svgText(INNER_PAD, 55, 'WHEN YOU CODE', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 700,
    spacing: 3,
  }));

  const morning = hourOfDay.filter((e) => e.hour >= 6 && e.hour < 12).reduce((s, e) => s + e.tokens, 0);
  const afternoon = hourOfDay.filter((e) => e.hour >= 12 && e.hour < 18).reduce((s, e) => s + e.tokens, 0);
  const evening = hourOfDay.filter((e) => e.hour >= 18 && e.hour < 22).reduce((s, e) => s + e.tokens, 0);
  const night = hourOfDay.filter((e) => e.hour >= 22 || e.hour < 6).reduce((s, e) => s + e.tokens, 0);

  const periods = [
    { label: 'Morning', icon: 'sun' as IconName, tokens: morning, color: theme.warmAccent },
    { label: 'Afternoon', icon: 'star' as IconName, tokens: afternoon, color: theme.goldAccent },
    { label: 'Evening', icon: 'fire' as IconName, tokens: evening, color: theme.purpleAccent },
    { label: 'Night', icon: 'moon' as IconName, tokens: night, color: theme.coolAccent },
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

  const cardWidth = (WIDTH - INNER_PAD * 2 - 3 * 20) / 4;
  const cardsY = 140;
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]!;
    const cx = INNER_PAD + i * (cardWidth + 20);
    const pct = totalTokens > 0 ? (period.tokens / totalTokens) * 100 : 0;

    const cardBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
    parts.push(roundedRect(cx, cardsY, cardWidth, 200, cardBg, 16));

    // Icon
    parts.push(renderIcon(period.icon, cx + cardWidth / 2 - 16, cardsY + 24, 32, period.color));

    parts.push(svgText(cx + cardWidth / 2, cardsY + 90, period.label, {
      fill: theme.subtitleColor,
      size: 13,
      weight: 600,
      anchor: 'middle',
    }));

    parts.push(svgText(cx + cardWidth / 2, cardsY + 140, `${pct.toFixed(0)}%`, {
      fill: period.color,
      size: 36,
      weight: 800,
      anchor: 'middle',
    }));

    parts.push(svgText(cx + cardWidth / 2, cardsY + 170, formatNumber(period.tokens), {
      fill: theme.subtitleColor,
      size: 12,
      weight: 500,
      anchor: 'middle',
    }));
  }

  return { svg: parts.join('\n'), height };
}

// ── Slide 8: Cache Efficiency ────────────────────────────────────────
function renderCacheSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const height = 340;
  const parts: string[] = [];
  const stats = output.aggregated;
  const gradColors = theme.sectionBgs[7] ?? ['#001a0d', '#0d1117'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'cache-bg'));

  parts.push(svgText(INNER_PAD, 55, 'CACHE EFFICIENCY', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 700,
    spacing: 3,
  }));

  const hitRate = stats.cacheHitRate;
  const hitPct = (hitRate * 100).toFixed(1);

  // Gauge arc
  const gaugeCx = WIDTH - 240;
  const gaugeCy = 190;
  const gaugeR = 90;
  const gaugeWidth = 18;

  const trackColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  const bgArc = describeArc(gaugeCx, gaugeCy, gaugeR, -90, 270);
  parts.push(
    `<path d="${bgArc}" fill="none" stroke="${trackColor}" stroke-width="${gaugeWidth}" stroke-linecap="round"/>`,
  );

  if (hitRate > 0) {
    const sweepAngle = Math.min(hitRate * 360, 359);
    const fillArc = describeArc(gaugeCx, gaugeCy, gaugeR, -90, -90 + sweepAngle);
    parts.push(
      `<path d="${fillArc}" fill="none" stroke="${escapeXml(theme.greenAccent)}" stroke-width="${gaugeWidth}" stroke-linecap="round"/>`,
    );
  }

  parts.push(svgText(gaugeCx, gaugeCy + 10, `${hitPct}%`, {
    fill: theme.greenAccent,
    size: 36,
    weight: 800,
    anchor: 'middle',
  }));
  parts.push(svgText(gaugeCx, gaugeCy + 35, 'hit rate', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 500,
    anchor: 'middle',
  }));

  parts.push(svgText(INNER_PAD, 120, `${hitPct}% Cache Hit Rate`, {
    fill: theme.narrativeColor,
    size: 24,
    weight: 600,
  }));

  const cacheEcon = output.more?.cacheEconomics;
  if (cacheEcon) {
    parts.push(svgText(INNER_PAD, 170, `${formatNumber(cacheEcon.readTokens)} cache reads`, {
      fill: theme.subtitleColor,
      size: 16,
      weight: 500,
    }));
    parts.push(svgText(INNER_PAD, 200, `${formatNumber(cacheEcon.writeTokens)} cache writes`, {
      fill: theme.subtitleColor,
      size: 16,
      weight: 500,
    }));
    if (cacheEcon.reuseRatio !== null && Number.isFinite(cacheEcon.reuseRatio)) {
      parts.push(svgText(INNER_PAD, 230, `${cacheEcon.reuseRatio.toFixed(1)}x reuse ratio`, {
        fill: theme.greenAccent,
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
  const height = 320;
  const parts: string[] = [];
  const stats = output.aggregated;
  const gradColors = theme.sectionBgs[8] ?? ['#1a1500', '#0d1117'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'peak-bg'));

  parts.push(
    `<circle cx="${WIDTH / 2}" cy="160" r="140" fill="${escapeXml(theme.goldAccent)}" opacity="0.04"/>`,
  );

  parts.push(svgText(INNER_PAD, 55, 'PEAK DAY SPOTLIGHT', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 700,
    spacing: 3,
  }));

  if (!stats.peakDay) {
    parts.push(svgText(INNER_PAD, 180, 'No usage data recorded yet', {
      fill: theme.subtitleColor,
      size: 20,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height };
  }

  const formattedDate = formatDateLong(stats.peakDay.date);
  parts.push(svgText(INNER_PAD, 110, `${formattedDate} was your biggest day`, {
    fill: theme.narrativeColor,
    size: 24,
    weight: 600,
  }));

  parts.push(svgText(INNER_PAD, 210, formatNumber(stats.peakDay.tokens), {
    fill: theme.goldAccent,
    size: 72,
    weight: 800,
  }));
  parts.push(svgText(INNER_PAD, 245, 'tokens in a single day', {
    fill: theme.subtitleColor,
    size: 16,
    weight: 500,
  }));

  // Trophy icon on the right
  const badgeCx = WIDTH - 200;
  const badgeCy = 180;
  parts.push(roundedRect(badgeCx - 60, badgeCy - 50, 120, 100, theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', 20));
  parts.push(svgIconTrophy(badgeCx - 24, badgeCy - 24, 48, theme.goldAccent));

  return { svg: parts.join('\n'), height };
}

// ── Slide 10: Achievements ───────────────────────────────────────────
function renderAchievementsSlide(
  output: TokenleakOutput,
  theme: WrappedTheme,
): SlideResult {
  const achievements = computeAchievements(output);
  const rows = Math.ceil(achievements.length / 2);
  const rowHeight = 100;
  const height = Math.max(240, 100 + rows * rowHeight + 40);
  const parts: string[] = [];
  const gradColors = theme.sectionBgs[9] ?? ['#120828', '#0a1628'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'achieve-bg'));

  parts.push(
    `<circle cx="600" cy="${height / 2}" r="200" fill="${escapeXml(theme.purpleAccent)}" opacity="0.03"/>`,
  );

  parts.push(svgText(INNER_PAD, 55, 'ACHIEVEMENTS UNLOCKED', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 700,
    spacing: 3,
  }));

  if (achievements.length === 0) {
    parts.push(svgText(INNER_PAD, 150, 'Keep coding to unlock achievements!', {
      fill: theme.subtitleColor,
      size: 18,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height: 240 };
  }

  const colWidth = (WIDTH - INNER_PAD * 2 - 24) / 2;
  for (let i = 0; i < achievements.length; i++) {
    const a = achievements[i]!;
    const col = i % 2;
    const row = Math.floor(i / 2);
    const ax = INNER_PAD + col * (colWidth + 24);
    const ay = 90 + row * rowHeight;

    const cardBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';
    parts.push(roundedRect(ax, ay, colWidth, 80, cardBg, 16));

    // Icon
    parts.push(renderIcon(a.icon, ax + 16, ay + 22, 36, a.color));

    // Title
    parts.push(svgText(ax + 66, ay + 35, a.title, {
      fill: theme.mode === 'dark' ? '#f1f5f9' : '#1e293b',
      size: 18,
      weight: 700,
    }));

    // Subtitle
    parts.push(svgText(ax + 66, ay + 58, a.subtitle, {
      fill: theme.subtitleColor,
      size: 13,
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
  const height = 300;
  const parts: string[] = [];
  const gradColors = theme.sectionBgs[10] ?? ['#0a1628', '#0d1117'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'burn-bg'));

  parts.push(svgText(INNER_PAD, 55, 'MONTHLY PROJECTION', {
    fill: theme.subtitleColor,
    size: 13,
    weight: 700,
    spacing: 3,
  }));

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
      fill: theme.coolAccent,
      size: 64,
      weight: 800,
    }));
    parts.push(svgText(INNER_PAD, 220, 'per month', {
      fill: theme.subtitleColor,
      size: 16,
      weight: 500,
    }));
    return { svg: parts.join('\n'), height };
  }

  parts.push(svgText(INNER_PAD, 115, 'At this rate, you will spend', {
    fill: theme.narrativeColor,
    size: 22,
    weight: 500,
  }));

  parts.push(svgText(INNER_PAD, 185, formatCost(burn.projectedCost), {
    fill: theme.coolAccent,
    size: 64,
    weight: 800,
  }));
  parts.push(svgText(INNER_PAD, 220, 'this month', {
    fill: theme.subtitleColor,
    size: 16,
    weight: 500,
  }));

  // Progress bar
  const barY = 252;
  const barWidth = WIDTH - INNER_PAD * 2;
  const barHeight = 16;
  const progress = burn.calendarDays > 0 ? burn.observedDays / burn.calendarDays : 0;

  const trackBg = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  parts.push(roundedRect(INNER_PAD, barY, barWidth, barHeight, trackBg, 8));
  parts.push(roundedRect(INNER_PAD, barY, Math.max(8, progress * barWidth), barHeight, theme.coolAccent, 8, { opacity: 0.7 }));

  parts.push(svgText(INNER_PAD, barY + 36, `Based on ${burn.observedDays} of ${burn.calendarDays} days`, {
    fill: theme.subtitleColor,
    size: 12,
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
  const gradColors = theme.sectionBgs[11] ?? ['#09090b', '#09090b'];

  parts.push(sectionBg(0, height, gradColors as [string, string], 'footer-bg'));

  parts.push(
    `<rect x="${INNER_PAD}" y="30" width="60" height="3" rx="1.5" fill="${escapeXml(theme.heroAccent)}" opacity="0.4"/>`,
  );

  parts.push(svgText(INNER_PAD, 65, 'Generated by tokenleak', {
    fill: theme.subtitleColor,
    size: 14,
    weight: 600,
  }));

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  parts.push(svgText(INNER_PAD, 90, now, {
    fill: theme.subtitleColor,
    size: 12,
    weight: 400,
    opacity: 0.6,
  }));

  parts.push(svgText(WIDTH - INNER_PAD, 70, 'tokenleak', {
    fill: theme.heroAccent,
    size: 18,
    weight: 700,
    anchor: 'end',
    opacity: 0.5,
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
    `<rect width="${WIDTH}" height="${totalHeight}" fill="${escapeXml(theme.mode === 'dark' ? '#09090b' : '#f8fafc')}"/>`,
    ...stackedSections,
    '</svg>',
  ].join('\n');
}
