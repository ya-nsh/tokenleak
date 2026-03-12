import type { TokenleakOutput, RenderOptions, DailyUsage } from '@tokenleak/core';
import { getTheme } from '../svg/theme';
import type { SvgTheme } from '../svg/theme';
import { escapeXml, formatNumber, formatCost } from '../svg/utils';

// ── Layout constants ──────────────────────────────────────────────────
const CARD_PADDING = 48;
const TITLEBAR_HEIGHT = 48;
const DOT_RADIUS = 6;
const DOT_GAP = 8;
const CELL_SIZE = 16;
const CELL_GAP = 4;
const STAT_GRID_COLS = 3;
const MODEL_BAR_HEIGHT = 8;

const FONT_FAMILY =
  "'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace";

// ── Terminal card theme (extends SvgTheme with card-specific values) ──
interface CardTheme {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  heatmap: readonly [string, string, string, string, string];
  barTrack: string;
  barGradient: readonly [string, string];
  shadow: string;
  glow: string;
  titlebarBorder: string;
}

function getCardTheme(mode: 'dark' | 'light'): CardTheme {
  if (mode === 'dark') {
    return {
      bg: '#0c0c0c',
      fg: '#ffffff',
      muted: '#52525b',
      border: 'rgba(255,255,255,0.06)',
      accent: '#10b981',
      heatmap: ['transparent', '#052e16', '#064e3b', '#047857', '#10b981'],
      barTrack: '#1c1c1c',
      barGradient: ['#064e3b', '#10b981'],
      shadow: '0 20px 60px -12px rgba(0,0,0,0.7)',
      glow: '0 0 80px rgba(16,185,129,0.1)',
      titlebarBorder: 'rgba(255,255,255,0.06)',
    };
  }
  return {
    bg: '#fafafa',
    fg: '#18181b',
    muted: '#a1a1aa',
    border: 'rgba(0,0,0,0.08)',
    accent: '#059669',
    heatmap: ['transparent', '#d1fae5', '#6ee7b7', '#34d399', '#059669'],
    barTrack: '#e5e5e5',
    barGradient: ['#6ee7b7', '#059669'],
    shadow: '0 20px 60px -12px rgba(0,0,0,0.15)',
    glow: '0 0 80px rgba(5,150,105,0.08)',
    titlebarBorder: 'rgba(0,0,0,0.08)',
  };
}

// ── Heatmap quantile logic (reused from svg/heatmap.ts) ───────────────
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

// ── Month names ───────────────────────────────────────────────────────
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_NAMES_FULL = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Helpers ───────────────────────────────────────────────────────────
function formatDateRange(since: string, until: string): string {
  const s = new Date(since + 'T00:00:00Z');
  const u = new Date(until + 'T00:00:00Z');
  const diffMs = u.getTime() - s.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const sMonth = MONTH_NAMES_FULL[s.getUTCMonth()] ?? '';
  const uMonth = MONTH_NAMES_FULL[u.getUTCMonth()] ?? '';
  const sYear = s.getUTCFullYear();
  const uYear = u.getUTCFullYear();
  return `${sMonth} ${sYear} — ${uMonth} ${uYear} · ${days} DAYS`;
}

function formatPercentage(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatStreak(n: number): string {
  return `${n} day${n !== 1 ? 's' : ''}`;
}

// ── Main render function ──────────────────────────────────────────────
export function renderTerminalCardSvg(
  output: TokenleakOutput,
  options: RenderOptions,
): string {
  const theme = getCardTheme(options.theme);
  const pad = CARD_PADDING;

  // Merge all daily usage from all providers
  const allDaily: DailyUsage[] = [];
  for (const p of output.providers) {
    allDaily.push(...p.daily);
  }
  const tokenMap = new Map<string, number>();
  for (const d of allDaily) {
    tokenMap.set(d.date, (tokenMap.get(d.date) ?? 0) + d.totalTokens);
  }

  const stats = output.aggregated;
  const { since, until } = output.dateRange;

  // ── Heatmap grid computation ──────────────────────────────────────
  const dates = allDaily.map((d) => d.date).sort();
  const endStr = until ?? dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10);
  const startStr = since ?? dates[0] ?? endStr;

  const end = new Date(endStr + 'T00:00:00Z');
  const start = new Date(startStr + 'T00:00:00Z');
  const startDay = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - startDay);

  const allTokens = Array.from(tokenMap.values());
  const quantiles = computeQuantiles(allTokens);

  const DAY_LABEL_WIDTH = 44;
  const MONTH_LABEL_HEIGHT = 24;

  // Generate heatmap cells
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

    const fillColor = theme.heatmap[level];
    const cellFill = level === 0 ? (options.theme === 'dark' ? '#1a1a1a' : '#e4e4e7') : fillColor;

    const title = `${dateStr}: ${tokens.toLocaleString()} tokens`;
    cells.push(
      `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${escapeXml(cellFill)}" rx="3"><title>${escapeXml(title)}</title></rect>`,
    );

    const month = current.getUTCMonth();
    if (month !== lastMonth && row === 0) {
      lastMonth = month;
      monthLabels.push(
        `<text x="${x}" y="${MONTH_LABEL_HEIGHT - 8}" fill="${escapeXml(theme.muted)}" font-size="11" font-family="${escapeXml(FONT_FAMILY)}">${escapeXml(MONTH_NAMES[month] ?? '')}</text>`,
      );
    }

    if (row === 6) col++;
    current.setUTCDate(current.getUTCDate() + 1);
  }

  const totalCols = col + 1;
  const heatmapGridWidth = DAY_LABEL_WIDTH + totalCols * (CELL_SIZE + CELL_GAP);
  const heatmapHeight = MONTH_LABEL_HEIGHT + 7 * (CELL_SIZE + CELL_GAP);

  // Day labels for heatmap
  const dayLabelsSvg = [1, 3, 5, 0].map((i) => {
    // Show Mon, Wed, Fri, Sun
    const labels = ['Sun', 'Mon', '', 'Wed', '', 'Fri', ''];
    const label = i === 0 ? 'Sun' : labels[i] ?? '';
    if (!label) return '';
    const y = MONTH_LABEL_HEIGHT + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 2;
    return `<text x="0" y="${y}" fill="${escapeXml(theme.muted)}" font-size="11" font-family="${escapeXml(FONT_FAMILY)}">${escapeXml(label)}</text>`;
  }).join('');

  // ── Calculate overall card width ──────────────────────────────────
  const minContentWidth = Math.max(heatmapGridWidth, 700);
  const cardWidth = minContentWidth + pad * 2;
  const contentWidth = cardWidth - pad * 2;

  // ── Build sections with Y tracking ────────────────────────────────
  let y = 0;
  const sections: string[] = [];

  // Google Fonts import
  sections.push(`<defs><style>@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&amp;display=swap');</style></defs>`);

  // Background with rounded corners
  sections.push(`<rect width="${cardWidth}" height="__CARD_HEIGHT__" rx="12" fill="${escapeXml(theme.bg)}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`);

  // ── Title bar ─────────────────────────────────────────────────────
  // Clip the title bar to rounded top corners
  sections.push(`<clipPath id="titlebar-clip"><rect width="${cardWidth}" height="${TITLEBAR_HEIGHT}" rx="12"/></clipPath>`);
  sections.push(`<rect width="${cardWidth}" height="${TITLEBAR_HEIGHT}" fill="${escapeXml(theme.bg)}" clip-path="url(#titlebar-clip)"/>`);

  // Traffic light dots
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

  // "tokenleak" title
  const titleX = dots[2].cx + DOT_RADIUS + 20;
  sections.push(
    `<text x="${titleX}" y="${dotY + 5}" fill="${escapeXml(theme.muted)}" font-size="13" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500">${escapeXml('tokenleak')}</text>`,
  );

  // Title bar bottom border
  sections.push(`<line x1="0" y1="${TITLEBAR_HEIGHT}" x2="${cardWidth}" y2="${TITLEBAR_HEIGHT}" stroke="${escapeXml(theme.titlebarBorder)}" stroke-width="1"/>`);

  y = TITLEBAR_HEIGHT + pad * 0.6;

  // ── Command prompt line ───────────────────────────────────────────
  sections.push(
    `<text x="${pad}" y="${y + 16}" font-size="15" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500">` +
    `<tspan fill="${escapeXml(theme.accent)}">$</tspan>` +
    `<tspan fill="${escapeXml(theme.fg)}"> tokenleak</tspan>` +
    `<tspan fill="${escapeXml(theme.accent)}">_</tspan>` +
    `</text>`,
  );
  y += 40;

  // ── Date range header ─────────────────────────────────────────────
  const dateRangeText = formatDateRange(since, until);
  sections.push(
    `<text x="${pad}" y="${y + 14}" fill="${escapeXml(theme.muted)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="2">${escapeXml(dateRangeText)}</text>`,
  );
  y += 40;

  // ── Heatmap ───────────────────────────────────────────────────────
  sections.push(`<g transform="translate(${pad}, ${y})">`);
  sections.push(dayLabelsSvg);
  for (const label of monthLabels) sections.push(label);
  for (const cell of cells) sections.push(cell);
  sections.push('</g>');
  y += heatmapHeight + 32;

  // ── Divider ───────────────────────────────────────────────────────
  sections.push(`<line x1="${pad}" y1="${y}" x2="${cardWidth - pad}" y2="${y}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`);
  y += 28;

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

      // Label
      sections.push(
        `<text x="${x}" y="${startY}" fill="${escapeXml(theme.muted)}" font-size="10" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="1.5">${escapeXml(stat.label)}</text>`,
      );
      // Value
      const valueColor = stat.accent ? theme.accent : theme.fg;
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
  sections.push(`<line x1="${pad}" y1="${y}" x2="${cardWidth - pad}" y2="${y}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`);
  y += 28;

  sections.push(
    `<text x="${pad}" y="${y}" fill="${escapeXml(theme.muted)}" font-size="10" font-family="${escapeXml(FONT_FAMILY)}" font-weight="600" letter-spacing="2">${escapeXml('TOP MODELS')}</text>`,
  );
  y += 24;

  const topModels = stats.topModels.slice(0, 3);
  const modelNameWidth = 200;
  const percentWidth = 60;
  const barMaxWidth = contentWidth - modelNameWidth - percentWidth - 20;

  for (const model of topModels) {
    const barWidth = Math.max(4, (model.percentage / 100) * barMaxWidth);

    // Model name
    sections.push(
      `<text x="${pad}" y="${y + MODEL_BAR_HEIGHT + 4}" fill="${escapeXml(theme.muted)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="400">${escapeXml(model.model)}</text>`,
    );

    // Bar track
    const barX = pad + modelNameWidth;
    sections.push(
      `<rect x="${barX}" y="${y}" width="${barMaxWidth}" height="${MODEL_BAR_HEIGHT}" rx="4" fill="${escapeXml(theme.barTrack)}"/>`,
    );

    // Bar fill with gradient
    const gradId = `grad-${model.model.replace(/[^a-zA-Z0-9]/g, '')}`;
    sections.push(
      `<defs><linearGradient id="${escapeXml(gradId)}" x1="0%" y1="0%" x2="100%" y2="0%">` +
      `<stop offset="0%" stop-color="${escapeXml(theme.barGradient[0])}"/>` +
      `<stop offset="100%" stop-color="${escapeXml(theme.barGradient[1])}"/>` +
      `</linearGradient></defs>`,
    );
    sections.push(
      `<rect x="${barX}" y="${y}" width="${barWidth}" height="${MODEL_BAR_HEIGHT}" rx="4" fill="url(#${escapeXml(gradId)})"/>`,
    );

    // Percentage
    sections.push(
      `<text x="${barX + barMaxWidth + 12}" y="${y + MODEL_BAR_HEIGHT + 4}" fill="${escapeXml(theme.muted)}" font-size="12" font-family="${escapeXml(FONT_FAMILY)}" font-weight="500" text-anchor="end">${escapeXml(`${model.percentage.toFixed(0)}%`)}</text>`,
    );

    y += 32;
  }

  // ── Final padding ─────────────────────────────────────────────────
  y += pad * 0.5;
  const cardHeight = y;

  // Replace placeholder height
  const svg = sections.join('\n').replace('__CARD_HEIGHT__', String(cardHeight));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}">`,
    svg,
    '</svg>',
  ].join('\n');
}
