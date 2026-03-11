import type { DailyUsage } from '@tokenleak/core';
import type { SvgTheme } from './theme';
import {
  CELL_SIZE,
  CELL_GAP,
  HEATMAP_ROWS,
  MONTH_LABEL_HEIGHT,
  DAY_LABEL_WIDTH,
  FONT_SIZE_SMALL,
  FONT_FAMILY,
} from './layout';
import { escapeXml, rect, text, group } from './utils';

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface HeatmapOptions {
  startDate?: string;
  endDate?: string;
}

/** Determine which heatmap level (0-4) a token count falls into */
function getLevel(tokens: number, quantiles: number[]): number {
  if (tokens <= 0) return 0;
  if (tokens <= quantiles[0]) return 1;
  if (tokens <= quantiles[1]) return 2;
  if (tokens <= quantiles[2]) return 3;
  return 4;
}

/** Compute quantile boundaries from non-zero token values */
function computeQuantiles(values: number[]): number[] {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [0, 0, 0];
  const q = (p: number): number => {
    const idx = Math.floor(p * (nonZero.length - 1));
    return nonZero[idx] ?? 0;
  };
  return [q(0.25), q(0.5), q(0.75)];
}

/** Render a GitHub-style heatmap from daily usage data */
export function renderHeatmap(
  daily: DailyUsage[],
  theme: SvgTheme,
  options: HeatmapOptions = {},
): { svg: string; width: number; height: number } {
  // Build a map of date -> total tokens
  const tokenMap = new Map<string, number>();
  for (const d of daily) {
    const existing = tokenMap.get(d.date) ?? 0;
    tokenMap.set(d.date, existing + d.totalTokens);
  }

  // Determine date range
  const dates = daily.map((d) => d.date).sort();
  const endStr = options.endDate ?? dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10);
  const startStr = options.startDate ?? dates[0] ?? endStr;

  const end = new Date(endStr);
  const start = new Date(startStr);

  // Adjust start to the beginning of its week (Sunday)
  const startDay = start.getDay();
  start.setDate(start.getDate() - startDay);

  // Generate all cells
  const cells: string[] = [];
  const allTokens = Array.from(tokenMap.values());
  const quantiles = computeQuantiles(allTokens);

  const current = new Date(start);
  let col = 0;
  const monthLabels: string[] = [];
  let lastMonth = -1;

  while (current <= end) {
    const row = current.getDay();
    const dateStr = current.toISOString().slice(0, 10);
    const tokens = tokenMap.get(dateStr) ?? 0;
    const level = getLevel(tokens, quantiles);

    const x = DAY_LABEL_WIDTH + col * (CELL_SIZE + CELL_GAP);
    const y = MONTH_LABEL_HEIGHT + row * (CELL_SIZE + CELL_GAP);

    const title = `${dateStr}: ${tokens.toLocaleString()} tokens`;
    cells.push(
      `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${escapeXml(theme.heatmap[level])}" rx="2"><title>${escapeXml(title)}</title></rect>`,
    );

    // Month label on first column of a new month
    const month = current.getMonth();
    if (month !== lastMonth && row === 0) {
      lastMonth = month;
      monthLabels.push(
        text(x, MONTH_LABEL_HEIGHT - 6, MONTH_NAMES[month] ?? '', {
          fill: theme.muted,
          'font-size': FONT_SIZE_SMALL,
          'font-family': FONT_FAMILY,
        }),
      );
    }

    // Advance to next day
    if (row === 6) {
      col++;
    }
    current.setDate(current.getDate() + 1);
  }

  // Day labels
  const dayLabels = DAY_LABELS.map((label, i) => {
    if (!label) return '';
    const y = MONTH_LABEL_HEIGHT + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 1;
    return text(0, y, label, {
      fill: theme.muted,
      'font-size': FONT_SIZE_SMALL,
      'font-family': FONT_FAMILY,
    });
  });

  const totalCols = col + 1;
  const width = DAY_LABEL_WIDTH + totalCols * (CELL_SIZE + CELL_GAP);
  const height = MONTH_LABEL_HEIGHT + HEATMAP_ROWS * (CELL_SIZE + CELL_GAP);

  const svg = group([...monthLabels, ...dayLabels, ...cells]);

  return { svg, width, height };
}
