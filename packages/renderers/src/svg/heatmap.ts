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
import { escapeXml, rect, text, group, formatNumber } from './utils';

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
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

  const end = new Date(endStr + 'T00:00:00Z');
  const start = new Date(startStr + 'T00:00:00Z');

  // Adjust start to the beginning of its week (Sunday)
  const startDay = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - startDay);

  // Generate all cells
  const cells: string[] = [];
  const allTokens = Array.from(tokenMap.values());
  const quantiles = computeQuantiles(allTokens);

  const current = new Date(start);
  let col = 0;
  const monthLabels: string[] = [];
  let lastMonth = -1;
  const cellRadius = 3;

  while (current <= end) {
    const row = current.getUTCDay();
    const dateStr = current.toISOString().slice(0, 10);
    const tokens = tokenMap.get(dateStr) ?? 0;
    const level = getLevel(tokens, quantiles);

    const x = DAY_LABEL_WIDTH + col * (CELL_SIZE + CELL_GAP);
    const y = MONTH_LABEL_HEIGHT + row * (CELL_SIZE + CELL_GAP);

    const title = `${dateStr}: ${tokens.toLocaleString()} tokens`;
    cells.push(
      `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${escapeXml(theme.heatmap[level])}" rx="${cellRadius}"><title>${escapeXml(title)}</title></rect>`,
    );

    // Month label on first column of a new month
    const month = current.getUTCMonth();
    if (month !== lastMonth && row === 0) {
      lastMonth = month;
      monthLabels.push(
        text(x, MONTH_LABEL_HEIGHT - 8, MONTH_NAMES[month] ?? '', {
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
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Day labels (Mon, Wed, Fri, Sun)
  const dayLabels = DAY_LABELS.map((label, i) => {
    if (!label) return '';
    const y = MONTH_LABEL_HEIGHT + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE - 2;
    return text(0, y, label, {
      fill: theme.muted,
      'font-size': FONT_SIZE_SMALL,
      'font-family': FONT_FAMILY,
    });
  });

  const totalCols = col + 1;
  const width = DAY_LABEL_WIDTH + totalCols * CELL_SIZE + Math.max(0, totalCols - 1) * CELL_GAP;
  const height = MONTH_LABEL_HEIGHT + HEATMAP_ROWS * CELL_SIZE + (HEATMAP_ROWS - 1) * CELL_GAP;

  // Legend: LESS [...squares...] MORE
  const legendY = height + 16;
  const legendItems: string[] = [];
  const legendStartX = 0;

  legendItems.push(
    text(legendStartX, legendY + CELL_SIZE - 2, 'LESS', {
      fill: theme.muted,
      'font-size': 9,
      'font-family': FONT_FAMILY,
      'font-weight': '600',
      'letter-spacing': '0.5',
    }),
  );

  const legendBoxStart = legendStartX + 40;
  for (let i = 0; i < 5; i++) {
    legendItems.push(
      `<rect x="${legendBoxStart + i * (CELL_SIZE + 3)}" y="${legendY}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${escapeXml(theme.heatmap[i as 0 | 1 | 2 | 3 | 4])}" rx="${cellRadius}"/>`,
    );
  }

  legendItems.push(
    text(legendBoxStart + 5 * (CELL_SIZE + 3) + 4, legendY + CELL_SIZE - 2, 'MORE', {
      fill: theme.muted,
      'font-size': 9,
      'font-family': FONT_FAMILY,
      'font-weight': '600',
      'letter-spacing': '0.5',
    }),
  );

  const totalHeight = legendY + CELL_SIZE + 8;

  const svg = group([...monthLabels, ...dayLabels, ...cells, ...legendItems]);

  return { svg, width, height: totalHeight };
}
