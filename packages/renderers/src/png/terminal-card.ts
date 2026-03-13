import type {
  TokenleakOutput,
  RenderOptions,
  DailyUsage,
  ProviderData,
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
  MODEL_BAR_HEIGHT,
  DAY_LABEL_WIDTH,
  MONTH_LABEL_HEIGHT,
  PROVIDER_SECTION_GAP,
  MIN_CONTENT_WIDTH,
  MODEL_NAME_WIDTH,
  MODEL_BAR_GAP,
} from '../card/layout';

// Sans-serif for all UI text (stats, labels, model names, heatmap axes)
const FONT_FAMILY =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
// Monospace kept only for the terminal prompt line
const MONO_FONT_FAMILY =
  "'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace";

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
      bg: '#09090b',
      fg: '#ffffff',
      muted: '#52525b',
      border: 'rgba(255,255,255,0.06)',
      accent: '#10b981',
      heatmapEmpty: '#141418',
      barTrack: '#18181b',
      titlebarBorder: 'rgba(255,255,255,0.06)',
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
 * Level 0 is empty (transparent), levels 1-4 interpolate between the gradient endpoints.
 */
function buildHeatmapScale(
  colors: ProviderColors,
  isDark: boolean,
): [string, string, string, string, string] {
  const [startHex, endHex] = colors.gradient;
  const s = hexToRgb(startHex);
  const e = hexToRgb(endHex);

  // For dark theme: levels go from very dim to bright
  // For light theme: levels go from very light to saturated
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

function formatRatio(value: number | null, suffix: string = 'x'): string {
  if (value === null || !Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)}${suffix}`;
}

function formatPercentPoints(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${(value * 100).toFixed(1)}pp`;
}

function formatHour(hour: number): string {
  return `${hour.toString().padStart(2, '0')}:00`;
}

function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || durationMs <= 0) {
    return 'n/a';
  }

  const totalMinutes = Math.round(durationMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
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

function renderMetricCard(
  x: number,
  y: number,
  width: number,
  title: string,
  lines: Array<{ label: string; value: string; accent?: boolean }>,
  theme: CardTheme,
  cardAccent: string,
): string {
  const parts: string[] = [];
  const height = 38 + lines.length * 22;

  parts.push(
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${escapeXml(theme.barTrack)}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="${x + 18}" y="${y + 22}" fill="${escapeXml(theme.muted)}" font-size="10" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="1.6">${escapeXml(title)}</text>`,
  );

  lines.forEach((line, index) => {
    const lineY = y + 48 + index * 22;
    parts.push(
      `<text x="${x + 18}" y="${lineY}" fill="${escapeXml(theme.muted)}" font-size="11" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500">${escapeXml(line.label)}</text>`,
    );
    parts.push(
      `<text x="${x + width - 18}" y="${lineY}" fill="${escapeXml(line.accent ? cardAccent : theme.fg)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="700" text-anchor="end">${escapeXml(line.value)}</text>`,
    );
  });

  return parts.join('\n');
}

function renderHourOfDayChart(
  x: number,
  y: number,
  width: number,
  hourOfDay: NonNullable<TokenleakOutput['more']>['hourOfDay'],
  theme: CardTheme,
  cardAccent: string,
): { svg: string; height: number } {
  const chartHeight = 140;
  const innerHeight = 72;
  const baselineY = y + 92;
  const barAreaX = x + 18;
  const barAreaWidth = width - 36;
  const barGap = 4;
  const barWidth = (barAreaWidth - barGap * 23) / 24;
  const maxTokens = Math.max(...hourOfDay.map((entry) => entry.tokens), 0);
  const busiest = hourOfDay.reduce(
    (best, entry) => (best === null || entry.tokens > best.tokens ? entry : best),
    null as (typeof hourOfDay)[number] | null,
  );

  const bars: string[] = [
    `<rect x="${x}" y="${y}" width="${width}" height="${chartHeight}" rx="10" fill="${escapeXml(theme.barTrack)}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
    `<text x="${x + 18}" y="${y + 22}" fill="${escapeXml(theme.muted)}" font-size="10" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="1.6">HOUR OF DAY</text>`,
    `<text x="${x + width - 18}" y="${y + 22}" fill="${escapeXml(theme.muted)}" font-size="11" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500" text-anchor="end">${escapeXml(
      busiest ? `${formatHour(busiest.hour)} peak` : 'No session events',
    )}</text>`,
  ];

  hourOfDay.forEach((entry, index) => {
    const barHeight = maxTokens > 0 ? Math.max(4, (entry.tokens / maxTokens) * innerHeight) : 4;
    const barX = barAreaX + index * (barWidth + barGap);
    const barY = baselineY - barHeight;

    bars.push(
      `<rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="4" fill="${escapeXml(cardAccent)}" opacity="${0.25 + (maxTokens > 0 ? entry.tokens / maxTokens : 0) * 0.75}"/>`,
    );
  });

  [0, 6, 12, 18, 23].forEach((hour) => {
    const labelX = barAreaX + hour * (barWidth + barGap) + barWidth / 2;
    bars.push(
      `<text x="${labelX}" y="${y + 116}" fill="${escapeXml(theme.muted)}" font-size="10" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500" text-anchor="middle">${escapeXml(
        hour.toString().padStart(2, '0'),
      )}</text>`,
    );
  });

  return {
    svg: bars.join('\n'),
    height: chartHeight,
  };
}

function renderModelMixShift(
  x: number,
  y: number,
  width: number,
  more: NonNullable<TokenleakOutput['more']>,
  theme: CardTheme,
  cardAccent: string,
): { svg: string; height: number } {
  if (!more.compare || more.compare.modelMixShift.length === 0) {
    return { svg: '', height: 0 };
  }

  const rows = more.compare.modelMixShift.slice(0, 4);
  const height = 38 + rows.length * 24;
  const parts: string[] = [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${escapeXml(theme.barTrack)}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
    `<text x="${x + 18}" y="${y + 22}" fill="${escapeXml(theme.muted)}" font-size="10" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="1.6">MODEL MIX SHIFT</text>`,
    `<text x="${x + width - 18}" y="${y + 22}" fill="${escapeXml(theme.muted)}" font-size="11" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500" text-anchor="end">${escapeXml(
      `${more.compare.previousRange.since} → ${more.compare.previousRange.until}`,
    )}</text>`,
  ];

  rows.forEach((row, index) => {
    const lineY = y + 48 + index * 24;
    parts.push(
      `<text x="${x + 18}" y="${lineY}" fill="${escapeXml(theme.fg)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600">${escapeXml(
        truncateText(row.model, 28),
      )}</text>`,
    );
    parts.push(
      `<text x="${x + width - 18}" y="${lineY}" fill="${escapeXml(row.deltaShare >= 0 ? cardAccent : '#f97316')}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="700" text-anchor="end">${escapeXml(
        formatPercentPoints(row.deltaShare),
      )}</text>`,
    );
    parts.push(
      `<text x="${x + width - 110}" y="${lineY}" fill="${escapeXml(theme.muted)}" font-size="11" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500" text-anchor="end">${escapeXml(
        `${(row.previousShare * 100).toFixed(1)}% → ${(row.currentShare * 100).toFixed(1)}%`,
      )}</text>`,
    );
  });

  return { svg: parts.join('\n'), height };
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
  const providerHeatmaps = providers.map((p) => {
    const heatmapColors = buildHeatmapScale(p.colors, isDark);
    return {
      provider: p,
      heatmap: renderProviderHeatmap(p.daily, since, until, heatmapColors, theme.heatmapEmpty),
      heatmapColors,
    };
  });

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

  // Background
  sections.push(
    `<rect width="${cardWidth}" height="__CARD_HEIGHT__" rx="12" fill="${escapeXml(theme.bg)}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
  );

  // ── Title bar ─────────────────────────────────────────────────────
  sections.push(`<clipPath id="titlebar-clip"><rect width="${cardWidth}" height="${TITLEBAR_HEIGHT}" rx="12"/></clipPath>`);
  sections.push(`<rect width="${cardWidth}" height="${TITLEBAR_HEIGHT}" fill="${escapeXml(theme.bg)}" clip-path="url(#titlebar-clip)"/>`);

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

  sections.push(`<line x1="0" y1="${TITLEBAR_HEIGHT}" x2="${cardWidth}" y2="${TITLEBAR_HEIGHT}" stroke="${escapeXml(theme.titlebarBorder)}" stroke-width="1"/>`);

  y = TITLEBAR_HEIGHT + pad * 0.6;

  // ── Command prompt ────────────────────────────────────────────────
  sections.push(
    `<text x="${pad}" y="${y + 16}" font-size="15" font-family="${escapeXml(MONO_FONT_FAMILY)}" font-weight="500">` +
    `<tspan fill="${escapeXml(cardAccent)}">$</tspan>` +
    `<tspan fill="${escapeXml(theme.fg)}"> tokenleak</tspan>` +
    `<tspan fill="${escapeXml(cardAccent)}">_</tspan>` +
    `</text>`,
  );
  y += 40;

  // ── Date range header ─────────────────────────────────────────────
  const dateRangeText = formatDateRange(since, until);
  sections.push(
    `<text x="${pad}" y="${y + 14}" fill="${escapeXml(theme.muted)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="2">${escapeXml(dateRangeText)}</text>`,
  );
  y += 40;

  // ── Per-provider sections (stacked vertically) ────────────────────
  for (let pi = 0; pi < providerHeatmaps.length; pi++) {
    const { provider, heatmap, heatmapColors } = providerHeatmaps[pi];

    // Provider header: colored dot + display name + token/cost summary
    const provDotRadius = 7;
    const provColor = provider.colors.primary;

    sections.push(
      `<circle cx="${pad + provDotRadius}" cy="${y + 10}" r="${provDotRadius}" fill="${escapeXml(provColor)}"/>`,
    );
    sections.push(
      `<text x="${pad + provDotRadius * 2 + 12}" y="${y + 15}" fill="${escapeXml(theme.fg)}" font-size="17" font-family="${escapeXml(FONT_FAMILY)}" font-weight="700">${escapeXml(provider.displayName)}</text>`,
    );

    // Inline summary on the right: total tokens · cost
    const summaryText = `${formatNumber(provider.totalTokens)} tokens · ${formatCost(provider.totalCost)}`;
    sections.push(
      `<text x="${cardWidth - pad}" y="${y + 15}" fill="${escapeXml(theme.muted)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500" text-anchor="end">${escapeXml(summaryText)}</text>`,
    );
    y += 32;

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
      y += 24;
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
  y += 28;

  // ── "OVERALL" label (only if multiple providers) ──────────────────
  if (providers.length > 1) {
    sections.push(
      `<text x="${pad}" y="${y}" fill="${escapeXml(theme.muted)}" font-size="10" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="2">${escapeXml('OVERALL')}</text>`,
    );
    y += 24;
  }

  // ── Stats grid (2 rows × 3 columns) ──────────────────────────────
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
      sections.push(
        `<text x="${x}" y="${startY}" fill="${escapeXml(theme.muted)}" font-size="10" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="1.5">${escapeXml(stat.label)}</text>`,
      );
      const valueColor = stat.accent ? cardAccent : theme.fg;
      sections.push(
        `<text x="${x}" y="${startY + 28}" fill="${escapeXml(valueColor)}" font-size="22" font-family="${escapeXml(FONT_FAMILY)}" font-weight="700">${escapeXml(stat.value)}</text>`,
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
    `<text x="${pad}" y="${y}" fill="${escapeXml(theme.muted)}" font-size="10" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="2">${escapeXml('TOP MODELS')}</text>`,
  );
  y += 24;

  const topModels = stats.topModels.slice(0, 3);
  const modelNameWidth = MODEL_NAME_WIDTH;
  const barGap = MODEL_BAR_GAP;
  const percentX = cardWidth - pad;
  const barX = pad + modelNameWidth;
  const barMaxWidth = Math.max(48, percentX - barX - barGap);

  for (const [index, model] of topModels.entries()) {
    const barWidth = Math.max(4, (model.percentage / 100) * barMaxWidth);

    sections.push(
      `<text x="${pad}" y="${y + MODEL_BAR_HEIGHT - 1}" fill="${escapeXml(theme.muted)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="400">${escapeXml(model.model)}</text>`,
    );

    sections.push(
      `<rect x="${barX}" y="${y}" width="${barMaxWidth}" height="${MODEL_BAR_HEIGHT}" rx="6" fill="${escapeXml(theme.barTrack)}"/>`,
    );

    const gradId = `grad-${index}-${model.model.replace(/[^a-zA-Z0-9]/g, '')}`;
    const barFill = providers.length === 1
      ? `url(#${escapeXml(gradId)})`
      : (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.18)');
    sections.push(
      `<defs><linearGradient id="${escapeXml(gradId)}" x1="0%" y1="0%" x2="100%" y2="0%">` +
      `<stop offset="0%" stop-color="${escapeXml(cardAccent)}44"/>` +
      `<stop offset="100%" stop-color="${escapeXml(cardAccent)}"/>` +
      `</linearGradient></defs>`,
    );
    sections.push(
      `<rect x="${barX}" y="${y}" width="${barWidth}" height="${MODEL_BAR_HEIGHT}" rx="6" fill="${escapeXml(barFill)}"/>`,
    );

    sections.push(
      `<text x="${percentX}" y="${y + MODEL_BAR_HEIGHT - 1}" fill="${escapeXml(theme.muted)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500" text-anchor="end">${escapeXml(`${model.percentage.toFixed(0)}%`)}</text>`,
    );

    y += 32;
  }

  if (options.more && output.more) {
    const more = output.more;
    const cardGap = 16;
    const detailCardWidth = (contentWidth - cardGap) / 2;

    y += 8;
    sections.push(
      `<line x1="${pad}" y1="${y}" x2="${cardWidth - pad}" y2="${y}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
    );
    y += 28;
    sections.push(
      `<text x="${pad}" y="${y}" fill="${escapeXml(theme.muted)}" font-size="10" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="2">${escapeXml('MORE')}</text>`,
    );
    y += 24;

    const efficiencyLines = [
      {
        label: 'Input / Output',
        value: more.inputOutput.inputPerOutput === null
          ? 'n/a'
          : `${more.inputOutput.inputPerOutput.toFixed(2)} : 1`,
        accent: true,
      },
      {
        label: 'Output / Input',
        value: formatRatio(more.inputOutput.outputPerInput),
      },
      {
        label: 'Output Share',
        value: formatPercentage(more.inputOutput.outputShare),
      },
    ];
    sections.push(
      renderMetricCard(
        pad,
        y,
        detailCardWidth,
        'INPUT / OUTPUT',
        efficiencyLines,
        theme,
        cardAccent,
      ),
    );

    const burnLines = [
      {
        label: 'Projected Cost',
        value: formatCost(more.monthlyBurn.projectedCost),
        accent: true,
      },
      {
        label: 'Projected Tokens',
        value: formatNumber(more.monthlyBurn.projectedTokens),
      },
      {
        label: 'Based On',
        value: `${more.monthlyBurn.observedDays} / ${more.monthlyBurn.calendarDays} days`,
      },
    ];
    sections.push(
      renderMetricCard(
        pad + detailCardWidth + cardGap,
        y,
        detailCardWidth,
        'PROJECTED MONTHLY BURN',
        burnLines,
        theme,
        cardAccent,
      ),
    );
    y += 38 + Math.max(efficiencyLines.length, burnLines.length) * 22 + 16;

    const cacheLines = [
      {
        label: 'Cache Reads',
        value: formatNumber(more.cacheEconomics.readTokens),
        accent: true,
      },
      {
        label: 'Cache Writes',
        value: formatNumber(more.cacheEconomics.writeTokens),
      },
      {
        label: 'Read Coverage',
        value: formatPercentage(more.cacheEconomics.readCoverage),
      },
      {
        label: 'Reuse Ratio',
        value: formatRatio(more.cacheEconomics.reuseRatio),
      },
    ];
    sections.push(
      renderMetricCard(
        pad,
        y,
        detailCardWidth,
        'CACHE ECONOMICS',
        cacheLines,
        theme,
        cardAccent,
      ),
    );

    const sessionLines = [
      {
        label: 'Sessions',
        value: String(more.sessionMetrics.totalSessions),
        accent: true,
      },
      {
        label: 'Avg Tokens',
        value: formatNumber(more.sessionMetrics.averageTokens),
      },
      {
        label: 'Avg Messages',
        value: more.sessionMetrics.averageMessages.toFixed(1),
      },
      {
        label: 'Avg Duration',
        value: formatDuration(more.sessionMetrics.averageDurationMs),
      },
      {
        label: more.sessionMetrics.topProject ? 'Top Project' : 'Longest Session',
        value: more.sessionMetrics.topProject
          ? truncateText(more.sessionMetrics.topProject.name, 20)
          : truncateText(more.sessionMetrics.longestSession?.label ?? 'n/a', 20),
      },
    ];
    sections.push(
      renderMetricCard(
        pad + detailCardWidth + cardGap,
        y,
        detailCardWidth,
        'SESSION STATS',
        sessionLines,
        theme,
        cardAccent,
      ),
    );
    y += 38 + Math.max(cacheLines.length, sessionLines.length) * 22 + 16;

    const hourChart = renderHourOfDayChart(
      pad,
      y,
      contentWidth,
      more.hourOfDay,
      theme,
      cardAccent,
    );
    sections.push(hourChart.svg);
    y += hourChart.height + 16;

    const mixShift = renderModelMixShift(
      pad,
      y,
      contentWidth,
      more,
      theme,
      cardAccent,
    );
    if (mixShift.height > 0) {
      sections.push(mixShift.svg);
      y += mixShift.height + 12;
    }
  }

  // ── Final padding ─────────────────────────────────────────────────
  y += pad * 0.5;
  const cardHeight = y;

  const svg = sections.join('\n').replace('__CARD_HEIGHT__', String(cardHeight));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}" shape-rendering="geometricPrecision" text-rendering="optimizeLegibility" color-rendering="optimizeQuality">`,
    svg,
    '</svg>',
  ].join('\n');
}
