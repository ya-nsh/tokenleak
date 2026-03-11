import type { TokenleakOutput } from '@tokenleak/core';
import type { SvgTheme } from './theme';
import { getTheme } from './theme';
import { escapeXml, rect, text, group, formatNumber, formatCost } from './utils';
import { FONT_FAMILY } from './layout';

const WRAPPED_WIDTH = 1200;
const WRAPPED_HEIGHT = 630;
const WRAPPED_PADDING = 48;
const TITLE_SIZE = 32;
const STAT_LABEL_SIZE = 14;
const STAT_VALUE_SIZE = 28;
const WATERMARK_SIZE = 12;
const STAT_COLUMN_WIDTH = 240;
const STAT_ROW_HEIGHT = 80;

interface WrappedStat {
  label: string;
  value: string;
}

function buildWrappedStats(output: TokenleakOutput): WrappedStat[] {
  const stats = output.aggregated;
  const topProvider =
    output.providers.length > 0
      ? output.providers.reduce((a, b) =>
          a.totalTokens >= b.totalTokens ? a : b,
        ).displayName
      : 'None';

  return [
    { label: 'Current Streak', value: `${stats.currentStreak} days` },
    { label: 'Total Tokens', value: formatNumber(stats.totalTokens) },
    { label: 'Total Cost', value: formatCost(stats.totalCost) },
    { label: 'Top Provider', value: topProvider },
    {
      label: 'Peak Day',
      value: stats.peakDay
        ? `${stats.peakDay.date} (${formatNumber(stats.peakDay.tokens)})`
        : 'N/A',
    },
    { label: 'Active Days', value: `${stats.activeDays}` },
  ];
}

/**
 * Render a 1200x630 wrapped card SVG suitable for social sharing.
 */
export function renderWrappedCard(
  output: TokenleakOutput,
  themeMode: 'dark' | 'light' = 'dark',
): string {
  const theme: SvgTheme = getTheme(themeMode);
  const stats = buildWrappedStats(output);
  const sections: string[] = [];

  // Background
  sections.push(rect(0, 0, WRAPPED_WIDTH, WRAPPED_HEIGHT, theme.background, 16));

  // Accent bar at top
  sections.push(
    `<rect x="0" y="0" width="${WRAPPED_WIDTH}" height="6" fill="${escapeXml(theme.accent)}" rx="0"/>`,
  );

  // Title
  let y = WRAPPED_PADDING + TITLE_SIZE;
  sections.push(
    text(WRAPPED_PADDING, y, 'Tokenleak Wrapped', {
      fill: theme.foreground,
      'font-size': TITLE_SIZE,
      'font-family': FONT_FAMILY,
      'font-weight': 'bold',
    }),
  );

  // Date range subtitle
  y += 28;
  sections.push(
    text(
      WRAPPED_PADDING,
      y,
      `${output.dateRange.since} — ${output.dateRange.until}`,
      {
        fill: theme.muted,
        'font-size': 16,
        'font-family': FONT_FAMILY,
      },
    ),
  );

  // Stats grid (2 rows x 3 columns)
  const gridStartY = y + 48;
  const gridStartX = WRAPPED_PADDING;

  for (let i = 0; i < stats.length; i++) {
    const stat = stats[i];
    if (!stat) continue;
    const col = i % 3;
    const row = Math.floor(i / 3);
    const sx = gridStartX + col * STAT_COLUMN_WIDTH;
    const sy = gridStartY + row * STAT_ROW_HEIGHT;

    // Card background
    const cardWidth = STAT_COLUMN_WIDTH - 16;
    const cardHeight = STAT_ROW_HEIGHT - 12;
    sections.push(rect(sx, sy, cardWidth, cardHeight, theme.cardBackground, 8));

    // Value
    sections.push(
      text(sx + 16, sy + 32, stat.value, {
        fill: theme.accent,
        'font-size': STAT_VALUE_SIZE,
        'font-family': FONT_FAMILY,
        'font-weight': 'bold',
      }),
    );

    // Label
    sections.push(
      text(sx + 16, sy + 52, stat.label, {
        fill: theme.muted,
        'font-size': STAT_LABEL_SIZE,
        'font-family': FONT_FAMILY,
      }),
    );
  }

  // Provider badges
  if (output.providers.length > 0) {
    const badgeY = gridStartY + 2 * STAT_ROW_HEIGHT + 24;
    const providerNames = output.providers
      .map((p) => p.displayName)
      .join('  ·  ');
    sections.push(
      text(WRAPPED_PADDING, badgeY, providerNames, {
        fill: theme.accentSecondary,
        'font-size': 16,
        'font-family': FONT_FAMILY,
      }),
    );
  }

  // Watermark
  sections.push(
    text(WRAPPED_WIDTH - WRAPPED_PADDING, WRAPPED_HEIGHT - 24, 'tokenleak', {
      fill: theme.muted,
      'font-size': WATERMARK_SIZE,
      'font-family': FONT_FAMILY,
      'text-anchor': 'end',
      opacity: '0.6',
    }),
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WRAPPED_WIDTH}" height="${WRAPPED_HEIGHT}" viewBox="0 0 ${WRAPPED_WIDTH} ${WRAPPED_HEIGHT}">`,
    ...sections,
    '</svg>',
  ].join('\n');
}
