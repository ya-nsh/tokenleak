import type {
  TokenleakOutput,
  RenderOptions,
  DailyUsage,
  ProviderColors,
} from '@tokenleak/core';
import { escapeXml, formatNumber, formatCost } from '../svg/utils';
import {
  CARD_PADDING,
  TITLEBAR_HEIGHT,
  DOT_RADIUS,
  DOT_GAP,
  CELL_SIZE,
  CELL_GAP,
  STAT_GRID_COLS,
  DAY_LABEL_WIDTH,
  MONTH_LABEL_HEIGHT,
  PROVIDER_SECTION_GAP,
  MIN_CONTENT_WIDTH,
  MODEL_NAME_WIDTH,
  MODEL_BAR_GAP,
} from '../card/layout';

// Sans-serif for all UI text (stats, labels, model names, heatmap axes)
const FONT_FAMILY =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif";
// Monospace kept only for the terminal prompt line
const MONO_FONT_FAMILY =
  "'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace";

// Local visual constants — refined design overrides
const CARD_RX = 16;
const STAT_VAL_SIZE = 28;    // stat value font-size (was 22)
const BAR_H = 11;            // model bar height (was 8)
const BAR_R = 6;             // model bar corner radius (was 4)
const PROV_ACCENT_W = 3;     // colored left-border width for provider section
const PROV_ACCENT_H = 22;    // height of the provider accent bar

// ── Terminal card theme ───────────────────────────────────────────────
interface CardTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  heatmapEmpty: string;
  barTrack: string;
  titlebarBorder: string;
}

function getCardTheme(mode: 'dark' | 'light'): CardTheme {
  if (mode === 'dark') {
    return {
      bg: '#07070f',
      fg: '#f0f0f8',
      muted: '#44445a',
      border: 'rgba(120,120,220,0.08)',
      accent: '#10b981',
      heatmapEmpty: '#0e0e17',
      barTrack: 'rgba(255,255,255,0.07)',
      titlebarBorder: 'rgba(120,120,220,0.09)',
    };
  }
  return {
    bg: '#fafafa',
    fg: '#18181b',
    muted: '#a1a1aa',
    border: 'rgba(0,0,0,0.08)',
    accent: '#059669',
    heatmapEmpty: '#e4e4e7',
    barTrack: '#e5e5e5',
    titlebarBorder: 'rgba(0,0,0,0.08)',
  };
}

/**
 * Generate a 5-level heatmap color scale from a provider's color gradient.
 */
function buildHeatmapScale(
  colors: ProviderColors,
  isDark: boolean,
): [string, string, string, string, string] {
  const [startHex, endHex] = colors.gradient;
  const s = hexToRgb(startHex);
  const e = hexToRgb(endHex);

  const opacities = isDark ? [0.15, 0.35, 0.6, 1.0] : [0.2, 0.4, 0.65, 1.0];

  return [
    'transparent',
    ...opacities.map((t) => {
      const r = Math.round(s.r + (e.r - s.r) * t);
      const g = Math.round(s.g + (e.g - s.g) * t);
      const b = Math.round(s.b + (e.b - s.b) * t);
      return rgbToHex(r, g, b);
    }),
  ] as [string, string, string, string, string];
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ── Heatmap quantile logic ────────────────────────────────────────────
function computeQuantiles(values: number[]): number[] {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [0, 0, 0];
  const q = (p: number): number => {
    const idx = Math.floor(p * (nonZero.length - 1));
    return nonZero[idx] ?? 0;
  };
  return [q(0.25), q(0.5), q(0.75)];
}

function getLevel(tokens: number, quantiles: number[]): number {
  if (tokens <= 0) return 0;
  if (tokens <= quantiles[0]) return 1;
  if (tokens <= quantiles[1]) return 2;
  if (tokens <= quantiles[2]) return 3;
  return 4;
}

// ── Month / day names ─────────────────────────────────────────────────
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTH_NAMES_FULL = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

// ── Helpers ───────────────────────────────────────────────────────────
function formatDateRange(since: string, until: string): string {
  const s = new Date(since + 'T00:00:00Z');
  const u = new Date(until + 'T00:00:00Z');
  const diffMs = u.getTime() - s.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const sMonth = MONTH_NAMES_FULL[s.getUTCMonth()] ?? '';
  const uMonth = MONTH_NAMES_FULL[u.getUTCMonth()] ?? '';
  return `${sMonth} ${s.getUTCFullYear()} — ${uMonth} ${u.getUTCFullYear()} · ${days} DAYS`;
}

function formatPercentage(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatStreak(n: number): string {
  return `${n} day${n !== 1 ? 's' : ''}`;
}

// ── Heatmap renderer for a single provider ────────────────────────────
interface HeatmapResult {
  svg: string;
  gridWidth: number;
  height: number;
}

function renderProviderHeatmap(
  daily: DailyUsage[],
  since: string,
  until: string,
  heatmapColors: [string, string, string, string, string],
  emptyColor: string,
): HeatmapResult {
  const tokenMap = new Map<string, number>();
  for (const d of daily) {
    tokenMap.set(d.date, (tokenMap.get(d.date) ?? 0) + d.totalTokens);
  }

  const dates = daily.map((d) => d.date).sort();
  const endStr = until ?? dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10);
  const startStr = since ?? dates[0] ?? endStr;

  const end = new Date(endStr + 'T00:00:00Z');
  const start = new Date(startStr + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());

  const allTokens = Array.from(tokenMap.values());
  const quantiles = computeQuantiles(allTokens);

  const cells: string[] = [];
  const monthLabels: string[] = [];
  let lastMonth = -1;
  let col = 0;
  const current = new Date(start);

  while (current <= end) {
    const row = current.getUTCDay();
    const dateStr = current.toISOString().slice(0, 10);
    const tokens = tokenMap.get(dateStr) ?? 0;
    const level = getLevel(tokens, quantiles);

    const x = DAY_LABEL_WIDTH + col * (CELL_SIZE + CELL_GAP);
    const y = MONTH_LABEL_HEIGHT + row * (CELL_SIZE + CELL_GAP);
    const fill = level === 0 ? emptyColor : heatmapColors[level];

    const title = `${dateStr}: ${tokens.toLocaleString()} tokens`;
    cells.push(
      `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${escapeXml(fill)}" rx="3"><title>${escapeXml(title)}</title></rect>`,
    );

    const month = current.getUTCMonth();
    if (month !== lastMonth && row === 0) {
      lastMonth = month;
      monthLabels.push(
        `<text x="${x}" y="${MONTH_LABEL_HEIGHT - 8}" fill="__MUTED__" font-size="11" font-family="${escapeXml(FONT_FAMILY)}">${escapeXml(MONTH_NAMES[month] ?? '')}</text>`,
      );
    }

    if (row === 6) col++;
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Day labels (all 7 days)
  const dayLabels = [
    { label: 'Sun', row: 0 },
    { label: 'Mon', row: 1 },
    { label: 'Tue', row: 2 },
    { label: 'Wed', row: 3 },
    { label: 'Thu', row: 4 },
    { label: 'Fri', row: 5 },
    { label: 'Sat', row: 6 },
  ].map((d) => {
    const y = MONTH_LABEL_HEIGHT + d.row * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 2;
    return `<text x="0" y="${y}" fill="__MUTED__" font-size="11" font-family="${escapeXml(FONT_FAMILY)}">${escapeXml(d.label)}</text>`;
  }).join('');

  const totalCols = col + 1;
  const gridWidth = DAY_LABEL_WIDTH + totalCols * (CELL_SIZE + CELL_GAP);
  const height = MONTH_LABEL_HEIGHT + 7 * (CELL_SIZE + CELL_GAP);

  const svg = [dayLabels, ...monthLabels, ...cells].join('\n');
  return { svg, gridWidth, height };
}

// ── Main render function ──────────────────────────────────────────────
export function renderTerminalCardSvg(
  output: TokenleakOutput,
  options: RenderOptions,
): string {
  const theme = getCardTheme(options.theme);
  const isDark = options.theme === 'dark';
  const pad = CARD_PADDING;
  const stats = output.aggregated;
  const { since, until } = output.dateRange;
  const providers = output.providers;

  // Use the single provider's primary color as the card accent; fall back to theme accent for multi-provider
  const cardAccent = providers.length === 1 ? (providers[0]?.colors.primary ?? theme.accent) : theme.accent;

  // Pre-compute all provider heatmaps to determine max width
  const providerHeatmaps = providers.map((p) => ({
    provider: p,
    heatmap: renderProviderHeatmap(
      p.daily, since, until,
      buildHeatmapScale(p.colors, isDark),
      theme.heatmapEmpty,
    ),
  }));

  const maxHeatmapWidth = providerHeatmaps.reduce(
    (max, ph) => Math.max(max, ph.heatmap.gridWidth),
    0,
  );
  const minContentWidth = Math.max(maxHeatmapWidth, MIN_CONTENT_WIDTH);
  const cardWidth = minContentWidth + pad * 2;
  const contentWidth = cardWidth - pad * 2;

  // ── Build SVG sections ──────────────────────────────────────────────
  let y = 0;
  const sections: string[] = [];

  // ── Defs: gradients, patterns, filters ────────────────────────────
  const bgGradLight = isDark ? '#0e0e1e' : '#ffffff';
  const dotColor = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.035)';
  // Accent stripe gradient below titlebar (single provider only)
  const stripeGradDef = providers.length === 1
    ? `  <linearGradient id="accent-stripe-grad" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="${escapeXml(cardAccent)}" stop-opacity="0.55"/>
    <stop offset="55%" stop-color="${escapeXml(cardAccent)}" stop-opacity="0.25"/>
    <stop offset="100%" stop-color="${escapeXml(cardAccent)}" stop-opacity="0"/>
  </linearGradient>`
    : '';

  sections.push(
    `<defs>
  <linearGradient id="card-bg-grad" x1="0%" y1="0%" x2="90%" y2="100%">
    <stop offset="0%" stop-color="${escapeXml(bgGradLight)}"/>
    <stop offset="100%" stop-color="${escapeXml(theme.bg)}"/>
  </linearGradient>
  <pattern id="dot-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
    <circle cx="0.5" cy="0.5" r="0.5" fill="${escapeXml(dotColor)}"/>
  </pattern>
${stripeGradDef}</defs>`,
  );

  // ── Background ────────────────────────────────────────────────────
  sections.push(
    `<rect width="${cardWidth}" height="__CARD_HEIGHT__" rx="${CARD_RX}" fill="url(#card-bg-grad)" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
  );
  // Dot grid texture overlay
  sections.push(
    `<rect width="${cardWidth}" height="__CARD_HEIGHT__" rx="${CARD_RX}" fill="url(#dot-grid)"/>`,
  );

  // ── Title bar ─────────────────────────────────────────────────────
  sections.push(`<clipPath id="titlebar-clip"><rect width="${cardWidth}" height="${TITLEBAR_HEIGHT}" rx="${CARD_RX}"/></clipPath>`);
  sections.push(
    `<rect width="${cardWidth}" height="${TITLEBAR_HEIGHT}" fill="${isDark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.02)'}" clip-path="url(#titlebar-clip)"/>`,
  );

  const dotY = TITLEBAR_HEIGHT / 2;
  const dotStartX = pad;
  const dots = [
    { color: '#ff5f57', cx: dotStartX },
    { color: '#febc2e', cx: dotStartX + DOT_RADIUS * 2 + DOT_GAP },
    { color: '#28c840', cx: dotStartX + (DOT_RADIUS * 2 + DOT_GAP) * 2 },
  ];
  for (const dot of dots) {
    sections.push(`<circle cx="${dot.cx}" cy="${dotY}" r="${DOT_RADIUS}" fill="${escapeXml(dot.color)}"/>`);
  }

  sections.push(
    `<line x1="0" y1="${TITLEBAR_HEIGHT}" x2="${cardWidth}" y2="${TITLEBAR_HEIGHT}" stroke="${escapeXml(theme.titlebarBorder)}" stroke-width="1"/>`,
  );

  // Thin accent stripe at base of titlebar (single provider → beautiful brand moment)
  if (providers.length === 1) {
    sections.push(
      `<rect x="0" y="${TITLEBAR_HEIGHT - 1}" width="${cardWidth}" height="2" fill="url(#accent-stripe-grad)"/>`,
    );
  }

  y = TITLEBAR_HEIGHT + pad * 0.65;

  // ── Command prompt ────────────────────────────────────────────────
  sections.push(
    `<text x="${pad}" y="${y + 16}" font-size="14" font-family="${escapeXml(MONO_FONT_FAMILY)}" font-weight="500">` +
    `<tspan fill="${escapeXml(cardAccent)}">$</tspan>` +
    `<tspan fill="${escapeXml(isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)')}"> tokenleak</tspan>` +
    `<tspan fill="${escapeXml(cardAccent)}">_</tspan>` +
    `</text>`,
  );
  y += 40;

  // ── Date range header ─────────────────────────────────────────────
  const dateRangeText = formatDateRange(since, until);
  sections.push(
    `<text x="${pad}" y="${y + 14}" fill="${escapeXml(theme.muted)}" font-size="11" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="2.5">${escapeXml(dateRangeText)}</text>`,
  );
  y += 40;

  // ── Per-provider sections (stacked vertically) ────────────────────
  for (let pi = 0; pi < providerHeatmaps.length; pi++) {
    const { provider, heatmap } = providerHeatmaps[pi];
    const provColor = provider.colors.primary;

    // Left accent bar + provider name
    sections.push(
      `<rect x="${pad}" y="${y}" width="${PROV_ACCENT_W}" height="${PROV_ACCENT_H}" rx="1.5" fill="${escapeXml(provColor)}"/>`,
    );
    sections.push(
      `<text x="${pad + PROV_ACCENT_W + 12}" y="${y + 16}" fill="${escapeXml(theme.fg)}" font-size="18" font-family="${escapeXml(FONT_FAMILY)}" font-weight="700">${escapeXml(provider.displayName)}</text>`,
    );

    // Inline summary on the right: total tokens · cost
    const summaryText = `${formatNumber(provider.totalTokens)} tokens · ${formatCost(provider.totalCost)}`;
    sections.push(
      `<text x="${cardWidth - pad}" y="${y + 16}" fill="${escapeXml(theme.muted)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500" text-anchor="end">${escapeXml(summaryText)}</text>`,
    );
    y += 34;

    // Heatmap
    const heatmapSvg = heatmap.svg.replace(/__MUTED__/g, escapeXml(theme.muted));
    sections.push(`<g transform="translate(${pad}, ${y})">`);
    sections.push(heatmapSvg);
    sections.push('</g>');
    y += heatmap.height;

    // Divider between providers (not after the last one)
    if (pi < providerHeatmaps.length - 1) {
      y += 12;
      sections.push(
        `<line x1="${pad}" y1="${y}" x2="${cardWidth - pad}" y2="${y}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
      );
      y += PROVIDER_SECTION_GAP - 12;
    } else {
      y += 28;
    }
  }

  // Handle empty providers
  if (providers.length === 0) {
    sections.push(
      `<text x="${pad}" y="${y + 14}" fill="${escapeXml(theme.muted)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500">${escapeXml('No provider data')}</text>`,
    );
    y += 32;
  }

  // ── Overall stats divider ─────────────────────────────────────────
  sections.push(
    `<line x1="${pad}" y1="${y}" x2="${cardWidth - pad}" y2="${y}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
  );
  y += 32;

  // ── "OVERALL" label (only if multiple providers) ──────────────────
  if (providers.length > 1) {
    sections.push(
      `<text x="${pad}" y="${y}" fill="${escapeXml(theme.muted)}" font-size="9" font-family="${escapeXml(FONT_FAMILY)}" font-weight="700" letter-spacing="2.5">${escapeXml('OVERALL')}</text>`,
    );
    y += 26;
  }

  // ── Stats grid — value first (large), label below (small caps) ────
  const statColWidth = contentWidth / STAT_GRID_COLS;
  const statsRow1 = [
    { label: 'CURRENT STREAK', value: formatStreak(stats.currentStreak), accent: true },
    { label: 'LONGEST STREAK', value: formatStreak(stats.longestStreak), accent: false },
    { label: 'TOTAL TOKENS', value: formatNumber(stats.totalTokens), accent: true },
  ];
  const statsRow2 = [
    { label: 'TOTAL COST', value: formatCost(stats.totalCost), accent: false },
    { label: '30-DAY TOKENS', value: formatNumber(stats.rolling30dTokens), accent: false },
    { label: 'CACHE HIT RATE', value: formatPercentage(stats.cacheHitRate), accent: false },
  ];

  function renderStatRow(row: typeof statsRow1, startY: number): void {
    for (let i = 0; i < row.length; i++) {
      const stat = row[i];
      const x = pad + i * statColWidth;
      const valueColor = stat.accent ? cardAccent : theme.fg;
      // Value first — big, bold, immediately readable
      sections.push(
        `<text x="${x}" y="${startY}" fill="${escapeXml(valueColor)}" font-size="${STAT_VAL_SIZE}" font-family="${escapeXml(FONT_FAMILY)}" font-weight="${stat.accent ? '800' : '700'}">${escapeXml(stat.value)}</text>`,
      );
      // Label below — small, muted, spaced caps (22px below value baseline gives ~15px clear of descenders)
      sections.push(
        `<text x="${x}" y="${startY + 22}" fill="${escapeXml(theme.muted)}" font-size="9" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="1.8">${escapeXml(stat.label)}</text>`,
      );
    }
  }

  renderStatRow(statsRow1, y);
  y += 60;
  renderStatRow(statsRow2, y);
  y += 60;

  // ── Top Models section ────────────────────────────────────────────
  y += 8;
  sections.push(
    `<line x1="${pad}" y1="${y}" x2="${cardWidth - pad}" y2="${y}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
  );
  y += 28;

  sections.push(
    `<text x="${pad}" y="${y}" fill="${escapeXml(theme.muted)}" font-size="9" font-family="${escapeXml(FONT_FAMILY)}" font-weight="700" letter-spacing="2.5">${escapeXml('TOP MODELS')}</text>`,
  );
  y += 22;

  const topModels = stats.topModels.slice(0, 3);
  const modelNameWidth = MODEL_NAME_WIDTH;
  const barGap = MODEL_BAR_GAP;
  const percentX = cardWidth - pad;
  const barX = pad + modelNameWidth;
  const barMaxWidth = Math.max(48, percentX - barX - barGap);

  for (const [index, model] of topModels.entries()) {
    const barWidth = Math.max(4, (model.percentage / 100) * barMaxWidth);
    const rowY = y + index * 36;

    // Model name
    sections.push(
      `<text x="${pad}" y="${rowY + BAR_H - 1}" fill="${escapeXml(isDark ? 'rgba(240,240,248,0.55)' : 'rgba(24,24,27,0.55)')}" font-size="12" font-family="${escapeXml(MONO_FONT_FAMILY)}" font-weight="400">${escapeXml(model.model)}</text>`,
    );

    // Bar track
    sections.push(
      `<rect x="${barX}" y="${rowY}" width="${barMaxWidth}" height="${BAR_H}" rx="${BAR_R}" fill="${escapeXml(theme.barTrack)}"/>`,
    );

    // Filled bar — gradient for single provider, neutral semi-white for multi
    const gradId = `grad-${index}-${model.model.replace(/[^a-zA-Z0-9]/g, '')}`;
    sections.push(
      `<defs><linearGradient id="${escapeXml(gradId)}" x1="0%" y1="0%" x2="100%" y2="0%">` +
      `<stop offset="0%" stop-color="${escapeXml(cardAccent)}44"/>` +
      `<stop offset="100%" stop-color="${escapeXml(cardAccent)}"/>` +
      `</linearGradient></defs>`,
    );
    const barFill = providers.length === 1
      ? `url(#${escapeXml(gradId)})`
      : (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)');
    sections.push(
      `<rect x="${barX}" y="${rowY}" width="${barWidth}" height="${BAR_H}" rx="${BAR_R}" fill="${escapeXml(barFill)}"/>`,
    );

    // Percentage
    sections.push(
      `<text x="${percentX}" y="${rowY + BAR_H - 1}" fill="${escapeXml(isDark ? 'rgba(240,240,248,0.6)' : 'rgba(24,24,27,0.6)')}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" text-anchor="end">${escapeXml(`${model.percentage.toFixed(0)}%`)}</text>`,
    );
  }

  y += topModels.length * 36;

  // ── Final padding ─────────────────────────────────────────────────
  y += pad * 0.6;
  const cardHeight = y;

  const svg = sections.join('\n').replace(/__CARD_HEIGHT__/g, String(cardHeight));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}" shape-rendering="geometricPrecision" text-rendering="optimizeLegibility" color-rendering="optimizeQuality">`,
    svg,
    '</svg>',
  ].join('\n');
}
