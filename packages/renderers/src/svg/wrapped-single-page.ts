import type { TokenleakOutput } from '@tokenleak/core';
import { escapeXml, formatNumber, formatCost } from './utils';
import { computeAchievements } from './wrapped-slides';

// ── Constants ────────────────────────────────────────────────────────
const WIDTH = 1200;
const PAD = 56;
const INNER = WIDTH - PAD * 2;

// Fonts — Bricolage Grotesque for display, Space Mono for labels, Space Grotesk for body
const DISPLAY = "'Bricolage Grotesque', 'SF Pro Display', 'Helvetica Neue', sans-serif";
const MONO = "'Space Mono', 'SF Mono', 'Menlo', monospace";
const BODY = "'Space Grotesk', 'SF Pro Text', 'Helvetica Neue', sans-serif";

// Wrapped-live color palette
const C = {
  bg: '#09090b',
  surface: '#111114',
  surface2: '#16161a',
  border: 'rgba(255,255,255,0.07)',
  borderHi: 'rgba(212,175,95,0.24)',
  gold: '#d4af5f',
  goldDim: '#a08040',
  ivory: '#f0ead6',
  ivoryDim: 'rgba(240,234,214,0.52)',
  text: '#e8e2cc',
  muted: 'rgba(232,226,204,0.38)',
  muted2: 'rgba(232,226,204,0.18)',
  // Provider colors
  providerDefault: '#555555',
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#d4af5f',
  'claude-code': '#d4af5f',
  openai: '#3a5070',
  codex: '#3a5070',
  google: '#6a2535',
  cursor: '#7c5cbf',
  pi: '#5a4a70',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── SVG Helpers ──────────────────────────────────────────────────────

function txt(
  x: number, y: number, content: string,
  opts: {
    fill?: string; size?: number; weight?: number;
    family?: string; anchor?: string; spacing?: number;
    opacity?: number; dominantBaseline?: string;
  } = {},
): string {
  const attrs = [
    `x="${x}"`, `y="${y}"`,
    `fill="${escapeXml(opts.fill ?? C.text)}"`,
    `font-size="${opts.size ?? 14}"`,
    `font-family="${escapeXml(opts.family ?? BODY)}"`,
    `font-weight="${opts.weight ?? 400}"`,
  ];
  if (opts.anchor) attrs.push(`text-anchor="${escapeXml(opts.anchor)}"`);
  if (opts.spacing !== undefined) attrs.push(`letter-spacing="${opts.spacing}"`);
  if (opts.opacity !== undefined) attrs.push(`opacity="${opts.opacity}"`);
  if (opts.dominantBaseline) attrs.push(`dominant-baseline="${opts.dominantBaseline}"`);
  return `<text ${attrs.join(' ')}>${escapeXml(content)}</text>`;
}

function box(
  x: number, y: number, w: number, h: number, fill: string,
  rx: number = 2,
  opts: { opacity?: number; stroke?: string; strokeWidth?: number } = {},
): string {
  const extra: string[] = [];
  if (opts.opacity !== undefined) extra.push(`opacity="${opts.opacity}"`);
  if (opts.stroke) extra.push(`stroke="${escapeXml(opts.stroke)}" stroke-width="${opts.strokeWidth ?? 1}"`);
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${escapeXml(fill)}" ${extra.join(' ')}/>`;
}

function line(x1: number, y1: number, x2: number, y2: number, color: string, width: number = 1, opacity: number = 1): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeXml(color)}" stroke-width="${width}" opacity="${opacity}"/>`;
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${MONTH_NAMES[d.getUTCMonth()]?.slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return `${MONTH_NAMES[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function getProviderColor(provider: string): string {
  return PROVIDER_COLORS[provider.toLowerCase()] ?? C.providerDefault;
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const start = { x: cx + r * Math.cos(toRad(endDeg)), y: cy + r * Math.sin(toRad(endDeg)) };
  const end = { x: cx + r * Math.cos(toRad(startDeg)), y: cy + r * Math.sin(toRad(startDeg)) };
  const large = endDeg - startDeg <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`;
}

// ── Section Label ────────────────────────────────────────────────────
function sectionTag(x: number, y: number, label: string): string {
  return txt(x, y, label, {
    fill: C.muted, size: 10, weight: 400, family: MONO, spacing: 2.5,
  });
}

// ── Noise texture def ────────────────────────────────────────────────
function noiseDef(): string {
  return [
    '<defs>',
    '<filter id="grain" x="0" y="0" width="100%" height="100%">',
    '<feTurbulence type="fractalNoise" baseFrequency="0.78" numOctaves="4" stitchTiles="stitch" result="noise"/>',
    '<feColorMatrix type="saturate" values="0" in="noise" result="mono"/>',
    '<feBlend in="SourceGraphic" in2="mono" mode="multiply"/>',
    '</filter>',
    '</defs>',
  ].join('\n');
}

// ── Main Renderer ────────────────────────────────────────────────────

export function renderWrappedSinglePageSvg(output: TokenleakOutput): string {
  const stats = output.aggregated;
  const more = output.more;
  const providers = output.providers;
  const { since, until } = output.dateRange;
  const achievements = computeAchievements(output);

  const parts: string[] = [];
  let y = 0;

  // ══════════════════════════════════════════════════════════════════
  // HEADER — Title + Date Range
  // ══════════════════════════════════════════════════════════════════
  const headerH = 220;
  parts.push(box(0, y, WIDTH, headerH, C.bg));
  // Subtle ambient radial gradients
  parts.push(`<defs><radialGradient id="amb1" cx="10%" cy="10%" r="60%"><stop offset="0%" stop-color="rgba(44,70,120,0.07)"/><stop offset="100%" stop-color="transparent"/></radialGradient></defs>`);
  parts.push(`<rect x="0" y="${y}" width="${WIDTH}" height="${headerH}" fill="url(#amb1)"/>`);
  // Gold hairline at very top
  parts.push(line(0, y, WIDTH, y, C.gold, 1, 0.5));

  // "AI Wrapped" hero text
  parts.push(txt(PAD, y + 72, 'AI Wrapped', {
    fill: C.ivory, size: 72, weight: 800, family: DISPLAY, spacing: -3,
  }));
  // Year accent
  const year = until.slice(0, 4);
  parts.push(txt(PAD + 540, y + 72, `'${year.slice(2)}`, {
    fill: C.gold, size: 72, weight: 800, family: DISPLAY, spacing: -3,
  }));

  // Date range
  parts.push(txt(PAD, y + 106, `${formatDateShort(since)} — ${formatDateShort(until)}`, {
    fill: C.muted, size: 14, weight: 400, family: MONO, spacing: 1,
  }));

  // Subtitle
  parts.push(txt(PAD, y + 140, 'Every prompt has a price. Here\'s yours.', {
    fill: C.ivoryDim, size: 16, weight: 400, family: BODY,
  }));

  // Stamp — right side
  const stampX = WIDTH - PAD - 240;
  parts.push(box(stampX, y + 85, 240, 40, 'transparent', 2, { stroke: C.borderHi, strokeWidth: 1 }));
  parts.push(txt(stampX + 16, y + 110, 'TokenLeak', {
    fill: C.gold, size: 16, weight: 800, family: DISPLAY, spacing: -0.5,
  }));
  parts.push(line(stampX + 120, y + 94, stampX + 120, y + 116, C.borderHi, 1));
  parts.push(txt(stampX + 134, y + 110, 'BUILT WITH TOKENLEAK', {
    fill: C.muted, size: 8, weight: 400, family: MONO, spacing: 1.5,
  }));

  // Days of data indicator
  const totalDays = Math.round(
    (new Date(until + 'T00:00:00Z').getTime() - new Date(since + 'T00:00:00Z').getTime()) /
    (1000 * 60 * 60 * 24),
  ) + 1;
  parts.push(`<circle cx="${PAD + 4}" cy="${y + 172}" r="3" fill="${C.gold}"/>`);
  parts.push(txt(PAD + 14, y + 176, `${totalDays} DAYS OF DATA`, {
    fill: C.muted, size: 9, weight: 400, family: MONO, spacing: 2,
  }));

  // Bottom border
  parts.push(line(PAD, y + headerH - 1, WIDTH - PAD, y + headerH - 1, C.gold, 1, 0.15));

  y += headerH;

  // ══════════════════════════════════════════════════════════════════
  // BIG NUMBERS — 4 stat cards in a row
  // ══════════════════════════════════════════════════════════════════
  const bigNumH = 150;
  parts.push(box(0, y, WIDTH, bigNumH, C.surface));

  sectionTag(PAD, y + 28, 'THE BIG NUMBERS');
  parts.push(sectionTag(PAD, y + 28, 'THE BIG NUMBERS'));

  const cardW = (INNER - 30) / 4; // 4 cards with 10px gaps
  const cardH = 85;
  const cardY = y + 42;

  const bigStats = [
    { label: 'TOTAL TOKENS', value: formatNumber(stats.totalTokens), unit: 'TOKENS', gold: false },
    { label: 'TOTAL COST', value: formatCost(stats.totalCost), unit: 'USD', gold: true },
    { label: 'ACTIVE DAYS', value: `${stats.activeDays}`, unit: `OF ${stats.totalDays}`, gold: false },
    { label: 'AVG / DAY', value: formatNumber(stats.averageDailyTokens), unit: 'TOKENS', gold: false },
  ];

  for (let i = 0; i < bigStats.length; i++) {
    const stat = bigStats[i]!;
    const cx = PAD + i * (cardW + 10);
    parts.push(box(cx, cardY, cardW, cardH, C.surface2, 2, { stroke: C.border, strokeWidth: 1 }));
    parts.push(txt(cx + 16, cardY + 22, stat.label, {
      fill: C.muted, size: 9, weight: 400, family: MONO, spacing: 2,
    }));
    parts.push(txt(cx + 16, cardY + 55, stat.value, {
      fill: stat.gold ? C.gold : C.ivory, size: 30, weight: 800, family: DISPLAY, spacing: -1,
    }));
    parts.push(txt(cx + 16, cardY + 72, stat.unit, {
      fill: C.gold, size: 9, weight: 400, family: MONO, spacing: 1.5,
    }));
  }

  y += bigNumH;

  // ══════════════════════════════════════════════════════════════════
  // MIDDLE SECTION — Two columns
  // Left: Top Models + Provider Mix
  // Right: Day of Week + Time of Day
  // ══════════════════════════════════════════════════════════════════
  const midH = 520;
  parts.push(box(0, y, WIDTH, midH, C.bg));
  const colW = (INNER - 24) / 2;
  const leftX = PAD;
  const rightX = PAD + colW + 24;

  // ── LEFT COLUMN: Top Models ──
  let ly = y + 28;
  parts.push(sectionTag(leftX, ly, 'YOUR TOP MODELS'));
  ly += 22;

  const topModels = stats.topModels.slice(0, 3);
  if (topModels.length > 0) {
    const maxPct = Math.max(...topModels.map((m) => m.percentage), 1);
    for (let i = 0; i < topModels.length; i++) {
      const m = topModels[i]!;
      const barMaxW = colW - 80;
      const barW = Math.max(4, (m.percentage / maxPct) * barMaxW);
      const opacity = i === 0 ? 1 : i === 1 ? 0.6 : 0.35;

      parts.push(txt(leftX, ly + 14, m.model, {
        fill: C.text, size: 14, weight: 500, family: BODY,
      }));
      parts.push(txt(leftX + colW, ly + 14, `${m.percentage.toFixed(1)}%`, {
        fill: C.gold, size: 13, weight: 700, family: MONO, anchor: 'end',
      }));

      // Hairline track
      parts.push(line(leftX, ly + 26, leftX + colW, ly + 26, 'rgba(255,255,255,0.09)', 1));
      // Gold fill
      parts.push(line(leftX, ly + 26, leftX + barW, ly + 26, C.gold, 1, opacity));

      ly += 46;
    }
  }

  // ── LEFT COLUMN: Provider Mix ──
  ly += 10;
  parts.push(sectionTag(leftX, ly, 'PROVIDER MIX'));
  ly += 22;

  const totalProviderTokens = providers.reduce((s, p) => s + p.totalTokens, 0);
  const providerMix = providers
    .map((p) => ({
      name: p.displayName,
      pct: totalProviderTokens > 0 ? (p.totalTokens / totalProviderTokens) * 100 : 0,
      color: getProviderColor(p.provider),
    }))
    .sort((a, b) => b.pct - a.pct);

  // Donut chart
  const donutCx = leftX + 70;
  const donutCy = ly + 75;
  const donutR = 52;
  const donutStroke = 14;

  // Track
  parts.push(`<circle cx="${donutCx}" cy="${donutCy}" r="${donutR}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="${donutStroke}"/>`);

  // Segments
  const circumference = 2 * Math.PI * donutR;
  let dashOffset = circumference / 4;
  for (const p of providerMix) {
    const dash = (p.pct / 100) * circumference;
    parts.push(`<circle cx="${donutCx}" cy="${donutCy}" r="${donutR}" fill="none" stroke="${escapeXml(p.color)}" stroke-width="${donutStroke}" stroke-linecap="butt" stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}" stroke-dashoffset="${dashOffset.toFixed(1)}"/>`);
    dashOffset -= dash;
  }

  // Center text
  parts.push(txt(donutCx, donutCy + 5, `${providers.length}`, {
    fill: C.ivory, size: 22, weight: 800, family: DISPLAY, anchor: 'middle',
  }));
  parts.push(txt(donutCx, donutCy + 20, 'providers', {
    fill: C.muted, size: 8, weight: 400, family: MONO, anchor: 'middle', spacing: 1,
  }));

  // Provider legend (right of donut)
  const legendX = leftX + 160;
  for (let i = 0; i < providerMix.length; i++) {
    const p = providerMix[i]!;
    const py = ly + 40 + i * 30;
    // Color swatch
    parts.push(box(legendX, py, 8, 8, p.color, 1));
    parts.push(txt(legendX + 16, py + 8, p.name, {
      fill: C.text, size: 13, weight: 500, family: BODY,
    }));
    parts.push(txt(leftX + colW, py + 8, `${p.pct.toFixed(0)}%`, {
      fill: C.gold, size: 12, weight: 700, family: MONO, anchor: 'end',
    }));
  }

  // ── RIGHT COLUMN: Day of Week ──
  let ry = y + 28;
  parts.push(sectionTag(rightX, ry, 'CODING DAYS'));
  ry += 22;

  const dow = stats.dayOfWeek;
  const dowOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun
  const dowEntries = dowOrder.map((dayNum) => {
    const entry = dow.find((e) => e.day === dayNum);
    return { label: DAY_NAMES[dayNum] ?? '', tokens: entry?.tokens ?? 0 };
  });
  const maxDowTokens = Math.max(...dowEntries.map((e) => e.tokens), 1);

  if (dow.length > 0) {
    const peakDow = dowEntries.reduce((a, b) => (b.tokens > a.tokens ? b : a));
    const peakDowFull = DAY_NAMES_FULL[dowOrder[dowEntries.indexOf(peakDow)] ?? 0] ?? '';
    parts.push(txt(rightX, ry + 14, `${peakDowFull} is your peak`, {
      fill: C.ivory, size: 18, weight: 700, family: DISPLAY, spacing: -0.5,
    }));
    ry += 30;

    const barGap = 8;
    const barW = (colW - 6 * barGap) / 7;
    const barMaxH = 100;

    for (let i = 0; i < 7; i++) {
      const entry = dowEntries[i]!;
      const bx = rightX + i * (barW + barGap);
      const ratio = entry.tokens / maxDowTokens;
      const barH = Math.max(3, ratio * barMaxH);
      const by = ry + barMaxH - barH;
      const isPeak = entry.tokens === maxDowTokens;
      const opacity = ratio < 0.35 ? 0.35 : ratio < 0.55 ? 0.6 : 1;

      parts.push(box(bx, by, barW, barH, C.gold, 1, { opacity }));

      parts.push(txt(bx + barW / 2, ry + barMaxH + 16, entry.label, {
        fill: isPeak ? C.gold : C.muted, size: 9, weight: isPeak ? 700 : 400,
        family: MONO, anchor: 'middle', spacing: 0.5,
      }));
    }
    ry += barMaxH + 30;
  }

  // ── RIGHT COLUMN: Time of Day ──
  ry += 14;
  parts.push(sectionTag(rightX, ry, 'WHEN YOU CODE'));
  ry += 22;

  const hourOfDay = more?.hourOfDay;
  let todPeriods = [
    { label: 'Morning', range: '6am-12pm', pct: 25, icon: 'M' },
    { label: 'Afternoon', range: '12-6pm', pct: 25, icon: 'A' },
    { label: 'Evening', range: '6-10pm', pct: 25, icon: 'E' },
    { label: 'Night', range: '10pm-6am', pct: 25, icon: 'N' },
  ];

  if (hourOfDay) {
    const total = hourOfDay.reduce((s, e) => s + e.tokens, 0);
    if (total > 0) {
      const morning = hourOfDay.filter((e) => e.hour >= 6 && e.hour < 12).reduce((s, e) => s + e.tokens, 0);
      const afternoon = hourOfDay.filter((e) => e.hour >= 12 && e.hour < 18).reduce((s, e) => s + e.tokens, 0);
      const evening = hourOfDay.filter((e) => e.hour >= 18 && e.hour < 22).reduce((s, e) => s + e.tokens, 0);
      const night = total - morning - afternoon - evening;
      todPeriods = [
        { label: 'Morning', range: '6am-12pm', pct: Math.round((morning / total) * 100), icon: 'M' },
        { label: 'Afternoon', range: '12-6pm', pct: Math.round((afternoon / total) * 100), icon: 'A' },
        { label: 'Evening', range: '6-10pm', pct: Math.round((evening / total) * 100), icon: 'E' },
        { label: 'Night', range: '10pm-6am', pct: 100 - Math.round((morning / total) * 100) - Math.round((afternoon / total) * 100) - Math.round((evening / total) * 100), icon: 'N' },
      ];
    }
  }

  const peakPeriod = todPeriods.reduce((a, b) => (b.pct > a.pct ? b : a));
  const todCellW = (colW - 8) / 2;
  const todCellH = 65;

  for (let i = 0; i < 4; i++) {
    const period = todPeriods[i]!;
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = rightX + col * (todCellW + 8);
    const cy = ry + row * (todCellH + 8);
    const isPeak = period.label === peakPeriod.label;

    parts.push(box(cx, cy, todCellW, todCellH, C.surface2, 2, {
      stroke: isPeak ? C.borderHi : C.border, strokeWidth: 1,
    }));

    parts.push(txt(cx + 14, cy + 20, period.label.toUpperCase(), {
      fill: C.muted, size: 8, weight: 400, family: MONO, spacing: 1.5,
    }));
    parts.push(txt(cx + 14, cy + 44, `${period.pct}%`, {
      fill: isPeak ? C.gold : C.ivory, size: 22, weight: 800, family: DISPLAY, spacing: -0.5,
    }));
    parts.push(txt(cx + todCellW - 12, cy + 44, period.range, {
      fill: C.muted, size: 9, weight: 400, family: MONO, anchor: 'end',
    }));
  }

  y += midH;

  // ══════════════════════════════════════════════════════════════════
  // BOTTOM SECTION — Three columns: Streak | Cache | Peak Day
  // ══════════════════════════════════════════════════════════════════
  const bottomH = 270;
  parts.push(box(0, y, WIDTH, bottomH, C.surface));
  parts.push(line(PAD, y, WIDTH - PAD, y, C.gold, 1, 0.15));

  const col3W = (INNER - 32) / 3;

  // ── Col 1: Streak ──
  const c1x = PAD;
  let c1y = y + 28;
  parts.push(sectionTag(c1x, c1y, 'STREAK'));
  c1y += 22;

  parts.push(txt(c1x, c1y + 38, `${stats.longestStreak}`, {
    fill: C.gold, size: 56, weight: 800, family: DISPLAY, spacing: -2,
  }));
  parts.push(txt(c1x + (stats.longestStreak >= 100 ? 110 : stats.longestStreak >= 10 ? 75 : 42), c1y + 38, 'day longest', {
    fill: C.muted, size: 14, weight: 400, family: BODY,
  }));

  c1y += 58;
  parts.push(txt(c1x, c1y + 14, `Current: ${stats.currentStreak} days`, {
    fill: C.muted, size: 12, weight: 400, family: MONO, spacing: 0.5,
  }));

  // Streak dots — 30 dots showing recent activity
  c1y += 34;
  const activeDates = new Set<string>();
  for (const prov of providers) {
    for (const d of prov.daily) {
      if (d.totalTokens > 0) activeDates.add(d.date);
    }
  }
  const dotSize = 8;
  const dotGap = 3;
  const dotsPerRow = Math.floor(col3W / (dotSize + dotGap));
  for (let i = 0; i < 30; i++) {
    const dDate = new Date(new Date(until + 'T00:00:00Z').getTime() - (29 - i) * 86400000);
    const dateStr = dDate.toISOString().slice(0, 10);
    const isActive = activeDates.has(dateStr);
    const isCurrentStreak = i >= 30 - stats.currentStreak;
    const col = i % dotsPerRow;
    const row = Math.floor(i / dotsPerRow);
    const dx = c1x + col * (dotSize + dotGap);
    const dy = c1y + row * (dotSize + dotGap);

    let dotColor = C.surface2;
    let dotBorder = 'rgba(255,255,255,0.07)';
    if (isCurrentStreak) {
      dotColor = C.gold;
      dotBorder = C.gold;
    } else if (isActive) {
      dotColor = C.goldDim;
      dotBorder = C.goldDim;
    }
    parts.push(box(dx, dy, dotSize, dotSize, dotColor, 2, { stroke: dotBorder, strokeWidth: 1 }));
  }

  // ── Col 2: Cache Efficiency ──
  const c2x = PAD + col3W + 16;
  let c2y = y + 28;
  parts.push(sectionTag(c2x, c2y, 'CACHE'));
  c2y += 22;

  const hitRate = stats.cacheHitRate;
  const hitPct = Math.round(hitRate * 100);

  // Ring gauge
  const ringCx = c2x + col3W / 2;
  const ringCy = c2y + 70;
  const ringR = 48;
  const ringStroke = 10;

  parts.push(`<circle cx="${ringCx}" cy="${ringCy}" r="${ringR}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="${ringStroke}"/>`);

  if (hitRate > 0) {
    const sweep = Math.min(hitRate * 360, 359);
    const arc = describeArc(ringCx, ringCy, ringR, 0, sweep);
    parts.push(`<path d="${arc}" fill="none" stroke="${C.gold}" stroke-width="${ringStroke}" stroke-linecap="butt"/>`);
  }

  parts.push(txt(ringCx, ringCy + 5, `${hitPct}%`, {
    fill: C.gold, size: 28, weight: 800, family: DISPLAY, anchor: 'middle',
  }));
  parts.push(txt(ringCx, ringCy + 20, 'HIT RATE', {
    fill: C.muted, size: 8, weight: 400, family: MONO, anchor: 'middle', spacing: 1.5,
  }));

  // Cache stats below ring
  c2y += 140;
  const cacheEcon = more?.cacheEconomics;
  if (cacheEcon) {
    parts.push(txt(c2x, c2y + 14, `Reads: ${formatNumber(cacheEcon.readTokens)}`, {
      fill: C.text, size: 12, weight: 500, family: MONO,
    }));
    parts.push(txt(c2x, c2y + 32, `Writes: ${formatNumber(cacheEcon.writeTokens)}`, {
      fill: C.text, size: 12, weight: 500, family: MONO,
    }));
    if (cacheEcon.reuseRatio !== null && Number.isFinite(cacheEcon.reuseRatio)) {
      parts.push(txt(c2x, c2y + 50, `Reuse: ${cacheEcon.reuseRatio.toFixed(1)}x`, {
        fill: C.gold, size: 12, weight: 700, family: MONO,
      }));
    }
  }

  // ── Col 3: Peak Day ──
  const c3x = PAD + 2 * (col3W + 16);
  let c3y = y + 28;
  parts.push(sectionTag(c3x, c3y, 'PEAK DAY'));
  c3y += 22;

  if (stats.peakDay) {
    // Peak box
    parts.push(box(c3x, c3y, col3W, 140, C.surface2, 2, { stroke: C.borderHi, strokeWidth: 1 }));

    parts.push(txt(c3x + col3W / 2, c3y + 26, formatDateLong(stats.peakDay.date).toUpperCase(), {
      fill: C.muted, size: 9, weight: 400, family: MONO, anchor: 'middle', spacing: 2.5,
    }));

    parts.push(txt(c3x + col3W / 2, c3y + 80, formatNumber(stats.peakDay.tokens), {
      fill: C.gold, size: 48, weight: 800, family: DISPLAY, anchor: 'middle', spacing: -2,
    }));

    parts.push(txt(c3x + col3W / 2, c3y + 102, 'TOKENS IN ONE DAY', {
      fill: C.muted, size: 9, weight: 400, family: MONO, anchor: 'middle', spacing: 2,
    }));

    // Multiplier
    const multiplier = stats.averageDailyTokens > 0
      ? (stats.peakDay.tokens / stats.averageDailyTokens).toFixed(1)
      : '0';
    parts.push(txt(c3x + col3W / 2, c3y + 128, `${multiplier}x your daily average`, {
      fill: C.muted, size: 11, weight: 400, family: BODY, anchor: 'middle',
    }));
  } else {
    parts.push(txt(c3x, c3y + 60, 'No peak day data', {
      fill: C.muted, size: 14, weight: 400, family: BODY,
    }));
  }

  // Projection below peak day
  c3y += 160;
  const projectedCost = more?.monthlyBurn?.projectedCost ?? stats.averageDailyCost * 30;
  parts.push(txt(c3x, c3y, 'PROJECTED / MONTH', {
    fill: C.muted, size: 9, weight: 400, family: MONO, spacing: 2,
  }));
  parts.push(txt(c3x, c3y + 30, formatCost(projectedCost), {
    fill: C.ivory, size: 32, weight: 800, family: DISPLAY, spacing: -1,
  }));
  const avgDailyCostStr = stats.averageDailyCost >= 1
    ? `$${stats.averageDailyCost.toFixed(2)}`
    : `$${stats.averageDailyCost.toFixed(4)}`;
  parts.push(txt(c3x, c3y + 48, `${avgDailyCostStr} avg/day`, {
    fill: C.muted, size: 11, weight: 400, family: MONO, spacing: 0.5,
  }));

  y += bottomH;

  // ══════════════════════════════════════════════════════════════════
  // ACHIEVEMENTS — Badge row
  // ══════════════════════════════════════════════════════════════════
  const achH = 140;
  parts.push(box(0, y, WIDTH, achH, C.bg));
  parts.push(line(PAD, y, WIDTH - PAD, y, C.gold, 1, 0.15));

  parts.push(sectionTag(PAD, y + 26, `ACHIEVEMENTS · ${achievements.length} UNLOCKED`));

  // Badge definitions
  const ALL_BADGES = [
    { title: 'Streak Master', sub: '>30d streak' },
    { title: 'Night Owl', sub: '>40% night' },
    { title: 'Big Spender', sub: '>$100 total' },
    { title: 'Cache Master', sub: '>50% hit rate' },
    { title: 'Daily Driver', sub: '>80% active' },
    { title: 'Power User', sub: '>10k avg/day' },
    { title: 'Summit Day', sub: 'Peak >50k' },
    { title: 'Multi-Tool', sub: '3+ providers' },
    { title: 'Early Bird', sub: '>40% morning' },
    { title: 'Model Hopper', sub: '4+ models' },
  ];

  const earnedTitles = new Set(achievements.map((a) => a.title));
  const badgeW = (INNER - (ALL_BADGES.length - 1) * 8) / ALL_BADGES.length;
  const badgeH = 60;
  const badgeY = y + 44;

  for (let i = 0; i < ALL_BADGES.length; i++) {
    const badge = ALL_BADGES[i]!;
    const isEarned = earnedTitles.has(badge.title);
    const bx = PAD + i * (badgeW + 8);

    const opacity = isEarned ? 1 : 0.2;
    parts.push(`<g opacity="${opacity}">`);
    parts.push(box(bx, badgeY, badgeW, badgeH, C.surface2, 2, {
      stroke: isEarned ? C.borderHi : C.border, strokeWidth: 1,
    }));
    parts.push(txt(bx + badgeW / 2, badgeY + 26, badge.title, {
      fill: isEarned ? C.ivory : C.muted, size: 9, weight: 600, family: BODY, anchor: 'middle',
    }));
    parts.push(txt(bx + badgeW / 2, badgeY + 44, badge.sub, {
      fill: C.muted, size: 7.5, weight: 400, family: MONO, anchor: 'middle', spacing: 0.5,
    }));
    parts.push('</g>');
  }

  y += achH;

  // ══════════════════════════════════════════════════════════════════
  // FOOTER
  // ══════════════════════════════════════════════════════════════════
  const footH = 50;
  parts.push(box(0, y, WIDTH, footH, C.bg));
  parts.push(line(PAD, y, WIDTH - PAD, y, C.gold, 1, 0.15));

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  parts.push(txt(PAD, y + 30, `Generated ${now}`, {
    fill: C.muted2, size: 9, weight: 400, family: MONO, spacing: 1,
  }));
  parts.push(txt(WIDTH - PAD, y + 30, 'tokenleak.dev', {
    fill: C.gold, size: 11, weight: 700, family: MONO, anchor: 'end', opacity: 0.5, spacing: 0.5,
  }));

  y += footH;

  // ══════════════════════════════════════════════════════════════════
  // COMPOSE SVG
  // ══════════════════════════════════════════════════════════════════
  const totalHeight = y;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${totalHeight}" viewBox="0 0 ${WIDTH} ${totalHeight}" shape-rendering="geometricPrecision" text-rendering="optimizeLegibility">`,
    `<rect width="${WIDTH}" height="${totalHeight}" fill="${C.bg}"/>`,
    noiseDef(),
    `<rect width="${WIDTH}" height="${totalHeight}" fill="transparent" filter="url(#grain)" opacity="0.03" pointer-events="none"/>`,
    ...parts,
    '</svg>',
  ].join('\n');
}
