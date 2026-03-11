import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { getTheme } from './theme';
import type { SvgTheme } from './theme';
import {
  PADDING,
  SECTION_GAP,
  FONT_SIZE_TITLE,
  FONT_SIZE_SUBTITLE,
  FONT_SIZE_STAT_VALUE,
  FONT_SIZE_STAT_LABEL,
  FONT_SIZE_SMALL,
  FONT_FAMILY,
} from './layout';
import { escapeXml, rect, text, group, formatNumber } from './utils';
import { renderHeatmap } from './heatmap';

/** Minimum SVG width in pixels */
const MIN_SVG_WIDTH = 800;

/** Render a large stat (label on top, big value below) */
function renderHeaderStat(
  x: number,
  y: number,
  label: string,
  value: string,
  theme: SvgTheme,
  align: 'start' | 'end' = 'end',
): string {
  const anchor = align === 'end' ? 'end' : 'start';
  return group([
    text(x, y, label, {
      fill: theme.muted,
      'font-size': FONT_SIZE_STAT_LABEL,
      'font-family': FONT_FAMILY,
      'font-weight': '700',
      'text-anchor': anchor,
      'letter-spacing': '1',
    }),
    text(x, y + 34, value, {
      fill: theme.foreground,
      'font-size': FONT_SIZE_STAT_VALUE,
      'font-family': FONT_FAMILY,
      'font-weight': '700',
      'text-anchor': anchor,
    }),
  ]);
}

/** Render a bottom stat card */
function renderBottomStat(
  x: number,
  y: number,
  label: string,
  value: string,
  theme: SvgTheme,
  cardWidth: number,
): string {
  return group([
    text(x, y, label, {
      fill: theme.muted,
      'font-size': FONT_SIZE_STAT_LABEL,
      'font-family': FONT_FAMILY,
      'font-weight': '700',
      'letter-spacing': '0.8',
    }),
    text(x, y + 32, value, {
      fill: theme.foreground,
      'font-size': 22,
      'font-family': FONT_FAMILY,
      'font-weight': '700',
    }),
  ]);
}

export class SvgRenderer implements IRenderer {
  readonly format = 'svg' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<string> {
    const theme = getTheme(options.theme);
    const sections: string[] = [];
    const sectionWidths: number[] = [];

    // === HEADER SECTION ===
    let y = PADDING;

    // Provider name (top-left)
    const providerName = output.providers.length > 0
      ? output.providers.map((p) => p.displayName).join(' + ')
      : 'Tokenleak';

    sections.push(
      text(PADDING, y + FONT_SIZE_TITLE, providerName, {
        fill: theme.foreground,
        'font-size': FONT_SIZE_TITLE,
        'font-family': FONT_FAMILY,
        'font-weight': '700',
      }),
    );

    // Date range below provider name
    sections.push(
      text(PADDING, y + FONT_SIZE_TITLE + 22, `${output.dateRange.since} — ${output.dateRange.until}`, {
        fill: theme.muted,
        'font-size': FONT_SIZE_SUBTITLE,
        'font-family': FONT_FAMILY,
      }),
    );

    // We need the heatmap width first to position header stats
    const allDaily = output.providers.flatMap((p) => p.daily);
    const heatmap = renderHeatmap(allDaily, theme, {
      startDate: output.dateRange.since,
      endDate: output.dateRange.until,
    });
    sectionWidths.push(heatmap.width);

    const contentWidth = Math.max(heatmap.width, MIN_SVG_WIDTH - PADDING * 2);

    // Header stats (top-right): INPUT TOKENS, OUTPUT TOKENS, TOTAL TOKENS
    const stats = output.aggregated;
    const headerStatSpacing = 180;
    const headerStatsX = PADDING + contentWidth;

    sections.push(
      renderHeaderStat(
        headerStatsX,
        y,
        'INPUT TOKENS',
        formatNumber(stats.totalInputTokens),
        theme,
      ),
    );
    sections.push(
      renderHeaderStat(
        headerStatsX - headerStatSpacing,
        y,
        'OUTPUT TOKENS',
        formatNumber(stats.totalOutputTokens),
        theme,
      ),
    );
    sections.push(
      renderHeaderStat(
        headerStatsX - headerStatSpacing * 2,
        y,
        'TOTAL TOKENS',
        formatNumber(stats.totalTokens),
        theme,
      ),
    );

    y += FONT_SIZE_TITLE + 22 + SECTION_GAP;

    // === HEATMAP SECTION ===
    if (allDaily.length > 0) {
      sections.push(
        group([heatmap.svg], `translate(${PADDING}, ${y})`),
      );
      y += heatmap.height + SECTION_GAP + 8;
    }

    // === DIVIDER ===
    sections.push(
      `<line x1="${PADDING}" y1="${y}" x2="${PADDING + contentWidth}" y2="${y}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
    );
    y += SECTION_GAP;

    // === BOTTOM STATS ROW ===
    const numCards = 4;
    const cardWidth = contentWidth / numCards;

    // Card 1: Most Used Model
    const topModel = stats.topModels.length > 0 ? stats.topModels[0] : null;
    const topModelLabel = topModel
      ? `${topModel.model} (${formatNumber(topModel.tokens)})`
      : 'N/A';

    sections.push(
      renderBottomStat(
        PADDING,
        y,
        'MOST USED MODEL',
        topModelLabel,
        theme,
        cardWidth,
      ),
    );

    // Card 2: Recent Use (Last 30 Days)
    const recent30Label = stats.rolling30dTopModel
      ? `${stats.rolling30dTopModel} (${formatNumber(stats.rolling30dTokens)})`
      : formatNumber(stats.rolling30dTokens);

    sections.push(
      renderBottomStat(
        PADDING + cardWidth,
        y,
        'RECENT USE (LAST 30 DAYS)',
        recent30Label,
        theme,
        cardWidth,
      ),
    );

    // Card 3: Longest Streak
    sections.push(
      renderBottomStat(
        PADDING + cardWidth * 2,
        y,
        'LONGEST STREAK',
        `${stats.longestStreak} days`,
        theme,
        cardWidth,
      ),
    );

    // Card 4: Current Streak
    sections.push(
      renderBottomStat(
        PADDING + cardWidth * 3,
        y,
        'CURRENT STREAK',
        `${stats.currentStreak} days`,
        theme,
        cardWidth,
      ),
    );

    y += 56 + SECTION_GAP;

    // === SECONDARY STATS ROW (additional useful data) ===
    sections.push(
      `<line x1="${PADDING}" y1="${y - SECTION_GAP / 2}" x2="${PADDING + contentWidth}" y2="${y - SECTION_GAP / 2}" stroke="${escapeXml(theme.border)}" stroke-width="1"/>`,
    );

    sections.push(
      renderBottomStat(
        PADDING,
        y,
        'TOTAL COST',
        stats.totalCost >= 100 ? `$${stats.totalCost.toFixed(0)}` : `$${stats.totalCost.toFixed(2)}`,
        theme,
        cardWidth,
      ),
    );

    sections.push(
      renderBottomStat(
        PADDING + cardWidth,
        y,
        'CACHE HIT RATE',
        `${(stats.cacheHitRate * 100).toFixed(1)}%`,
        theme,
        cardWidth,
      ),
    );

    sections.push(
      renderBottomStat(
        PADDING + cardWidth * 2,
        y,
        'ACTIVE DAYS',
        `${stats.activeDays} / ${stats.totalDays}`,
        theme,
        cardWidth,
      ),
    );

    sections.push(
      renderBottomStat(
        PADDING + cardWidth * 3,
        y,
        'AVG DAILY TOKENS',
        formatNumber(stats.averageDailyTokens),
        theme,
        cardWidth,
      ),
    );

    y += 56 + PADDING;

    // === ASSEMBLE SVG ===
    const totalHeight = y;
    const svgWidth = Math.max(contentWidth + PADDING * 2, MIN_SVG_WIDTH);

    // Watermark
    sections.push(
      text(svgWidth - PADDING, totalHeight - 16, 'tokenleak', {
        fill: theme.muted,
        'font-size': 10,
        'font-family': FONT_FAMILY,
        'text-anchor': 'end',
        opacity: '0.4',
      }),
    );

    const svgContent = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${totalHeight}" viewBox="0 0 ${svgWidth} ${totalHeight}">`,
      `<defs><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;display=swap');</style></defs>`,
      rect(0, 0, svgWidth, totalHeight, theme.background, 12),
      ...sections,
      '</svg>',
    ].join('\n');

    return svgContent;
  }
}
