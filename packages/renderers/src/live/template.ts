import type { TokenleakOutput, RenderOptions, DailyUsage } from '@tokenleak/core';
import { formatNumber, formatCost, escapeXml } from '../svg/utils';

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
  const sYear = s.getUTCFullYear();
  const uYear = u.getUTCFullYear();
  return `${sMonth} ${sYear} &mdash; ${uMonth} ${uYear} &middot; ${days} DAYS`;
}

function formatPercentage(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatStreak(n: number): string {
  return `${n} day${n !== 1 ? 's' : ''}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Heatmap quantile logic
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

interface HeatmapCell {
  date: string;
  tokens: number;
  level: number;
  row: number;
  col: number;
}

function buildHeatmapCells(
  allDaily: DailyUsage[],
  since: string,
  until: string,
): { cells: HeatmapCell[]; months: { label: string; col: number }[]; totalCols: number } {
  const tokenMap = new Map<string, number>();
  for (const d of allDaily) {
    tokenMap.set(d.date, (tokenMap.get(d.date) ?? 0) + d.totalTokens);
  }

  const dates = allDaily.map((d) => d.date).sort();
  const endStr = until ?? dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10);
  const startStr = since ?? dates[0] ?? endStr;

  const end = new Date(endStr + 'T00:00:00Z');
  const start = new Date(startStr + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());

  const allTokens = Array.from(tokenMap.values());
  const quantiles = computeQuantiles(allTokens);

  const cells: HeatmapCell[] = [];
  const months: { label: string; col: number }[] = [];
  let lastMonth = -1;
  let col = 0;
  const current = new Date(start);

  while (current <= end) {
    const row = current.getUTCDay();
    const dateStr = current.toISOString().slice(0, 10);
    const tokens = tokenMap.get(dateStr) ?? 0;
    const level = getLevel(tokens, quantiles);

    cells.push({ date: dateStr, tokens, level, row, col });

    const month = current.getUTCMonth();
    if (month !== lastMonth && row === 0) {
      lastMonth = month;
      months.push({ label: MONTH_NAMES[month] ?? '', col });
    }

    if (row === 6) col++;
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return { cells, months, totalCols: col + 1 };
}

export function generateHtml(output: TokenleakOutput, options: RenderOptions): string {
  const isDark = options.theme === 'dark';
  const stats = output.aggregated;
  const { since, until } = output.dateRange;

  const allDaily: DailyUsage[] = [];
  for (const p of output.providers) {
    allDaily.push(...p.daily);
  }

  const { cells, months, totalCols } = buildHeatmapCells(allDaily, since, until);
  const topModels = stats.topModels.slice(0, 3);

  // Colors
  const bg = isDark ? '#0c0c0c' : '#fafafa';
  const fg = isDark ? '#ffffff' : '#18181b';
  const muted = isDark ? '#52525b' : '#a1a1aa';
  const accent = isDark ? '#10b981' : '#059669';
  const border = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
  const emptyCell = isDark ? '#1a1a1a' : '#e4e4e7';
  const barTrack = isDark ? '#1c1c1c' : '#e5e5e5';
  const heatmapColors = isDark
    ? ['transparent', '#052e16', '#064e3b', '#047857', '#10b981']
    : ['transparent', '#d1fae5', '#6ee7b7', '#34d399', '#059669'];
  const gradStart = isDark ? '#064e3b' : '#6ee7b7';
  const gradEnd = isDark ? '#10b981' : '#059669';

  // Stat definitions
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

  // Build heatmap grid HTML
  const cellSize = 16;
  const cellGap = 4;
  const dayLabelWidth = 44;
  const monthLabelHeight = 24;

  const heatmapCellsHtml = cells.map((c) => {
    const x = dayLabelWidth + c.col * (cellSize + cellGap);
    const y = monthLabelHeight + c.row * (cellSize + cellGap);
    const fill = c.level === 0 ? emptyCell : heatmapColors[c.level];
    return `<div class="heatmap-cell" style="left:${x}px;top:${y}px;background:${fill}" data-date="${esc(c.date)}" data-tokens="${c.tokens}"></div>`;
  }).join('\n');

  const monthLabelsHtml = months.map((m) => {
    const x = dayLabelWidth + m.col * (cellSize + cellGap);
    return `<span class="month-label" style="left:${x}px">${esc(m.label)}</span>`;
  }).join('\n');

  const dayLabelsHtml = [
    { label: 'Mon', row: 1 },
    { label: 'Wed', row: 3 },
    { label: 'Fri', row: 5 },
    { label: 'Sun', row: 0 },
  ].map((d) => {
    const y = monthLabelHeight + d.row * (cellSize + cellGap) + cellSize - 2;
    return `<span class="day-label" style="top:${y - 10}px">${d.label}</span>`;
  }).join('\n');

  const heatmapWidth = dayLabelWidth + totalCols * (cellSize + cellGap);
  const heatmapHeight = monthLabelHeight + 7 * (cellSize + cellGap);

  const statsHtml = statRows.map((row) =>
    `<div class="stat-row">${row.map((s) =>
      `<div class="stat"><div class="stat-label">${s.label}</div><div class="stat-value${s.accent ? ' accent' : ''}">${s.value}</div></div>`
    ).join('')}</div>`
  ).join('');

  const modelsHtml = topModels.map((m) => {
    const width = Math.max(2, m.percentage);
    return `<div class="model-row">
      <span class="model-name">${esc(m.model)}</span>
      <div class="model-bar-track"><div class="model-bar-fill" style="width:${width}%"></div></div>
      <span class="model-pct">${m.percentage.toFixed(0)}%</span>
    </div>`;
  }).join('');

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
  .heatmap-container { position: relative; width: ${heatmapWidth}px; height: ${heatmapHeight}px; margin-bottom: 32px; }
  .heatmap-cell {
    position: absolute;
    width: ${cellSize}px;
    height: ${cellSize}px;
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
  .stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
  .stat-label { color: ${muted}; font-size: 10px; font-weight: 600; letter-spacing: 1.5px; margin-bottom: 8px; }
  .stat-value { color: ${fg}; font-size: 22px; font-weight: 700; }
  .stat-value.accent { color: ${accent}; }
  .models-section { margin-top: 8px; }
  .models-label { color: ${muted}; font-size: 10px; font-weight: 600; letter-spacing: 2px; margin-bottom: 16px; }
  .model-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .model-name { color: ${muted}; font-size: 12px; width: 200px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .model-bar-track { flex: 1; height: 8px; background: ${barTrack}; border-radius: 4px; overflow: hidden; }
  .model-bar-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, ${gradStart}, ${gradEnd}); }
  .model-pct { color: ${muted}; font-size: 12px; width: 40px; text-align: right; flex-shrink: 0; }
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
    <div class="heatmap-container">
      ${dayLabelsHtml}
      ${monthLabelsHtml}
      ${heatmapCellsHtml}
    </div>
    <hr class="divider">
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
    cell.addEventListener('mouseenter', e => {
      const date = cell.dataset.date;
      const tokens = Number(cell.dataset.tokens).toLocaleString();
      tooltip.textContent = date + ': ' + tokens + ' tokens';
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
