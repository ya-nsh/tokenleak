import type {
  TokenleakOutput,
  RenderOptions,
  ProviderData,
  ProviderColors,
} from '@tokenleak/core';
import { formatNumber, formatCost } from '../svg/utils';
import { buildHeatmapModel } from '../shared/heatmap-model';
import {
  CELL_SIZE,
  CELL_GAP,
  DAY_LABEL_WIDTH,
  MONTH_LABEL_HEIGHT,
  MODEL_NAME_WIDTH,
  MODEL_BAR_GAP,
  MODEL_PERCENT_WIDTH,
} from '../card/layout';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTH_NAMES_FULL = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

function formatDateRange(since: string, until: string): string {
  const s = new Date(since + 'T00:00:00Z');
  const u = new Date(until + 'T00:00:00Z');
  const diffMs = u.getTime() - s.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const sMonth = MONTH_NAMES_FULL[s.getUTCMonth()] ?? '';
  const uMonth = MONTH_NAMES_FULL[u.getUTCMonth()] ?? '';
  return `${sMonth} ${s.getUTCFullYear()} &mdash; ${uMonth} ${u.getUTCFullYear()} &middot; ${days} DAYS`;
}

function formatPercentage(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatStreak(n: number): string {
  return `${n} day${n !== 1 ? 's' : ''}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

interface HeatmapCell {
  date: string;
  tokens: number;
  level: number;
  row: number;
  col: number;
}

function buildHeatmapCells(
  provider: ProviderData,
  since: string,
  until: string,
): { cells: HeatmapCell[]; months: { label: string; col: number }[]; totalCols: number } {
  const model = buildHeatmapModel(provider.daily, { since, until });
  if (!model) {
    return { cells: [], months: [], totalCols: 0 };
  }
  const cells: HeatmapCell[] = [];
  const months: { label: string; col: number }[] = [];
  for (const marker of model.monthMarkers) {
    months.push({ label: marker.label, col: marker.weekIndex });
  }
  for (const week of model.weeks) {
    for (const day of week.days) {
      cells.push({
        date: day.date,
        tokens: day.tokens,
        level: day.level,
        row: day.dayIndex,
        col: week.index,
      });
    }
  }

  return { cells, months, totalCols: model.weeks.length };
}

function renderProviderHeatmapHtml(
  provider: ProviderData,
  since: string,
  until: string,
  isDark: boolean,
  emptyCell: string,
): string {
  const heatmapColors = buildHeatmapScale(provider.colors, isDark);
  const { cells, months, totalCols } = buildHeatmapCells(provider, since, until);

  const heatmapWidth = DAY_LABEL_WIDTH + totalCols * (CELL_SIZE + CELL_GAP);
  const heatmapHeight = MONTH_LABEL_HEIGHT + 7 * (CELL_SIZE + CELL_GAP);

  const cellsHtml = cells.map((c) => {
    const x = DAY_LABEL_WIDTH + c.col * (CELL_SIZE + CELL_GAP);
    const y = MONTH_LABEL_HEIGHT + c.row * (CELL_SIZE + CELL_GAP);
    const fill = c.level === 0 ? emptyCell : heatmapColors[c.level];
    return `<div class="heatmap-cell" style="left:${x}px;top:${y}px;background:${fill}" data-date="${esc(c.date)}" data-tokens="${c.tokens}"></div>`;
  }).join('\n');

  const monthLabelsHtml = months.map((m) => {
    const x = DAY_LABEL_WIDTH + m.col * (CELL_SIZE + CELL_GAP);
    return `<span class="month-label" style="left:${x}px">${esc(m.label)}</span>`;
  }).join('\n');

  const dayLabelsHtml = [
    { label: 'Mon', row: 1 },
    { label: 'Wed', row: 3 },
    { label: 'Fri', row: 5 },
    { label: 'Sun', row: 0 },
  ].map((d) => {
    const y = MONTH_LABEL_HEIGHT + d.row * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 2;
    return `<span class="day-label" style="top:${y - 10}px">${d.label}</span>`;
  }).join('\n');

  const summaryText = `${esc(formatNumber(provider.totalTokens))} tokens &middot; ${esc(formatCost(provider.totalCost))}`;

  return `<div class="provider-section" data-provider="${esc(provider.provider)}">
    <div class="provider-header">
      <div class="provider-name-row">
        <span class="provider-dot" style="background:${esc(provider.colors.primary)}"></span>
        <span class="provider-name">${esc(provider.displayName)}</span>
      </div>
      <span class="provider-summary">${summaryText}</span>
    </div>
    <div class="heatmap-container" style="width:${heatmapWidth}px;height:${heatmapHeight}px">
      ${dayLabelsHtml}
      ${monthLabelsHtml}
      ${cellsHtml}
    </div>
  </div>`;
}

export function generateHtml(output: TokenleakOutput, options: RenderOptions): string {
  const isDark = options.theme === 'dark';
  const stats = output.aggregated;
  const { since, until } = output.dateRange;
  const providers = output.providers;

  // Colors
  const bg = isDark ? '#0c0c0c' : '#fafafa';
  const fg = isDark ? '#ffffff' : '#18181b';
  const muted = isDark ? '#52525b' : '#a1a1aa';
  const accent = isDark ? '#10b981' : '#059669';
  const border = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  const emptyCell = isDark ? '#1a1a1a' : '#e4e4e7';
  const barTrack = isDark ? '#1c1c1c' : '#e5e5e5';

  // Per-provider heatmap sections
  const providerSectionsHtml = providers.map((p, i) => {
    const section = renderProviderHeatmapHtml(p, since, until, isDark, emptyCell);
    const divider = i < providers.length - 1 ? '<hr class="provider-divider">' : '';
    return section + divider;
  }).join('\n');

  // Overall stats
  const statRows = [
    [
      { label: 'CURRENT STREAK', value: esc(formatStreak(stats.currentStreak)), accent: true },
      { label: 'LONGEST STREAK', value: esc(formatStreak(stats.longestStreak)), accent: false },
      { label: 'TOTAL TOKENS', value: esc(formatNumber(stats.totalTokens)), accent: true },
    ],
    [
      { label: 'TOTAL COST', value: esc(formatCost(stats.totalCost)), accent: false },
      { label: '30-DAY TOKENS', value: esc(formatNumber(stats.rolling30dTokens)), accent: false },
      { label: 'CACHE HIT RATE', value: esc(formatPercentage(stats.cacheHitRate)), accent: false },
    ],
  ];

  const statsHtml = statRows.map((row) =>
    `<div class="stat-row">${row.map((s) =>
      `<div class="stat"><div class="stat-label">${s.label}</div><div class="stat-value${s.accent ? ' accent' : ''}">${s.value}</div></div>`
    ).join('')}</div>`
  ).join('');

  const topModels = stats.topModels.slice(0, 3);
  const modelsHtml = topModels.map((m) => {
    const width = Math.max(2, m.percentage);
    return `<div class="model-row">
      <span class="model-name">${esc(m.model)}</span>
      <div class="model-bar-track"><div class="model-bar-fill" style="width:${width}%"></div></div>
      <span class="model-pct">${m.percentage.toFixed(0)}%</span>
    </div>`;
  }).join('');

  const overallLabel = providers.length > 1
    ? '<div class="overall-label">OVERALL</div>'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tokenleak — live dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    background: ${isDark ? '#000' : '#f4f4f5'};
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 48px 24px;
    min-height: 100vh;
  }
  .card {
    background: ${bg};
    border-radius: 12px;
    border: 1px solid ${border};
    box-shadow: 0 20px 60px -12px ${isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.15)'}, 0 0 80px ${isDark ? 'rgba(16,185,129,0.1)' : 'rgba(5,150,105,0.08)'};
    max-width: 900px;
    width: 100%;
    overflow: hidden;
  }
  .titlebar {
    display: flex;
    align-items: center;
    height: 48px;
    padding: 0 20px;
    border-bottom: 1px solid ${border};
    gap: 8px;
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .dot-red { background: #ff5f57; }
  .dot-yellow { background: #febc2e; }
  .dot-green { background: #28c840; }
  .titlebar-label { color: ${muted}; font-size: 13px; font-weight: 500; margin-left: 12px; }
  .content { padding: 28px 48px 48px; }
  .prompt { font-size: 15px; font-weight: 500; margin-bottom: 24px; }
  .prompt .dollar { color: ${accent}; }
  .prompt .cmd { color: ${fg}; }
  .prompt .cursor { color: ${accent}; animation: blink 1s step-end infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .date-range { color: ${muted}; font-size: 12px; font-weight: 600; letter-spacing: 2px; margin-bottom: 24px; }

  /* Provider sections */
  .provider-section { margin-bottom: 12px; }
  .provider-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .provider-name-row { display: flex; align-items: center; gap: 10px; }
  .provider-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .provider-name { color: ${fg}; font-size: 14px; font-weight: 600; }
  .provider-summary { color: ${muted}; font-size: 11px; font-weight: 500; }
  .provider-divider { border: none; border-top: 1px solid ${border}; margin: 24px 0; }

  .heatmap-container { position: relative; margin-bottom: 8px; }
  .heatmap-cell {
    position: absolute;
    width: ${CELL_SIZE}px;
    height: ${CELL_SIZE}px;
    border-radius: 3px;
    cursor: pointer;
  }
  .heatmap-cell:hover { outline: 2px solid ${accent}; outline-offset: 1px; }
  .month-label { position: absolute; top: 0; color: ${muted}; font-size: 11px; }
  .day-label { position: absolute; left: 0; color: ${muted}; font-size: 11px; }
  .tooltip {
    display: none;
    position: fixed;
    background: ${isDark ? '#1c1c1c' : '#fff'};
    color: ${fg};
    border: 1px solid ${border};
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    pointer-events: none;
    z-index: 100;
    white-space: nowrap;
    box-shadow: 0 4px 12px ${isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.1)'};
  }

  .divider { border: none; border-top: 1px solid ${border}; margin: 0 0 28px; }
  .overall-label { color: ${muted}; font-size: 10px; font-weight: 600; letter-spacing: 2px; margin-bottom: 16px; }
  .stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
  .stat-label { color: ${muted}; font-size: 10px; font-weight: 600; letter-spacing: 1.5px; margin-bottom: 8px; }
  .stat-value { color: ${fg}; font-size: 22px; font-weight: 700; }
  .stat-value.accent { color: ${accent}; }
  .models-section { margin-top: 8px; }
  .models-label { color: ${muted}; font-size: 10px; font-weight: 600; letter-spacing: 2px; margin-bottom: 16px; }
  .model-row {
    display: grid;
    grid-template-columns: ${MODEL_NAME_WIDTH}px minmax(0, 1fr) ${MODEL_PERCENT_WIDTH}px;
    align-items: center;
    column-gap: ${MODEL_BAR_GAP}px;
    margin-bottom: 16px;
  }
  .model-name { color: ${muted}; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .model-bar-track { width: 100%; height: 8px; background: ${barTrack}; border-radius: 4px; overflow: hidden; }
  .model-bar-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, ${accent}44, ${accent}); }
  .model-pct { color: ${muted}; font-size: 12px; text-align: right; }
  .refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 24px;
    padding: 8px 16px;
    background: ${isDark ? '#1c1c1c' : '#e5e5e5'};
    color: ${muted};
    border: 1px solid ${border};
    border-radius: 6px;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .refresh-btn:hover { background: ${isDark ? '#262626' : '#d4d4d8'}; color: ${fg}; }
</style>
</head>
<body>
<div class="card">
  <div class="titlebar">
    <div class="dot dot-red"></div>
    <div class="dot dot-yellow"></div>
    <div class="dot dot-green"></div>
    <span class="titlebar-label">tokenleak</span>
  </div>
  <div class="content">
    <div class="prompt">
      <span class="dollar">$</span>
      <span class="cmd"> tokenleak</span>
      <span class="cursor">_</span>
    </div>
    <div class="date-range">${formatDateRange(since, until)}</div>
    ${providerSectionsHtml}
    <hr class="divider">
    ${overallLabel}
    ${statsHtml}
    <hr class="divider" style="margin-top:8px">
    <div class="models-section">
      <div class="models-label">TOP MODELS</div>
      ${modelsHtml}
    </div>
    <button class="refresh-btn" onclick="location.reload()">&#x21bb; Refresh</button>
  </div>
</div>
<div class="tooltip" id="tooltip"></div>
<script>
  const tooltip = document.getElementById('tooltip');
  document.querySelectorAll('.heatmap-cell').forEach(cell => {
    const section = cell.closest('.provider-section');
    const provider = section ? section.dataset.provider : '';
    cell.addEventListener('mouseenter', e => {
      const date = cell.dataset.date;
      const tokens = Number(cell.dataset.tokens).toLocaleString();
      tooltip.textContent = (provider ? provider + ' — ' : '') + date + ': ' + tokens + ' tokens';
      tooltip.style.display = 'block';
    });
    cell.addEventListener('mousemove', e => {
      tooltip.style.left = (e.clientX + 12) + 'px';
      tooltip.style.top = (e.clientY - 30) + 'px';
    });
    cell.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  });
</script>
</body>
</html>`;
}
