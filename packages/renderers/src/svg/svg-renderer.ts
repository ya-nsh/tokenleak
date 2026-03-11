import type { TokenleakOutput, RenderOptions } from '@tokenleak/core';
import type { IRenderer } from '../renderer';
import { getTheme } from './theme';
import {
  PADDING,
  HEADER_HEIGHT,
  SECTION_GAP,
  FONT_SIZE_TITLE,
  FONT_SIZE_SUBTITLE,
  FONT_FAMILY,
} from './layout';
import { escapeXml, rect, text, group } from './utils';
import { renderHeatmap } from './heatmap';
import { renderStatsPanel } from './stats-panel';
import { renderInsightsPanel } from './insights-panel';
import { renderDayOfWeekChart } from './day-of-week-chart';
import { renderModelChart } from './model-chart';

/** Minimum SVG width in pixels */
const MIN_SVG_WIDTH = 520;

export class SvgRenderer implements IRenderer {
  readonly format = 'svg' as const;

  async render(output: TokenleakOutput, options: RenderOptions): Promise<string> {
    const theme = getTheme(options.theme);
    let y = PADDING;

    const sections: string[] = [];
    // Track the widest section to compute final SVG width
    const sectionWidths: number[] = [];

    // Header
    sections.push(
      group([
        text(PADDING, y + FONT_SIZE_TITLE + 4, 'Tokenleak', {
          fill: theme.foreground,
          'font-size': FONT_SIZE_TITLE,
          'font-family': FONT_FAMILY,
          'font-weight': 'bold',
        }),
        text(PADDING, y + FONT_SIZE_TITLE + 4 + 20, `${output.dateRange.since} \u2014 ${output.dateRange.until}`, {
          fill: theme.muted,
          'font-size': FONT_SIZE_SUBTITLE,
          'font-family': FONT_FAMILY,
        }),
      ]),
    );
    y += HEADER_HEIGHT + SECTION_GAP;

    // Provider names
    if (output.providers.length > 0) {
      const providerNames = output.providers
        .map((p) => p.displayName)
        .join(' \u00b7 ');
      sections.push(
        text(PADDING, y, providerNames, {
          fill: theme.accent,
          'font-size': FONT_SIZE_SUBTITLE,
          'font-family': FONT_FAMILY,
        }),
      );
      y += SECTION_GAP;
    }

    // Merge all daily data for the heatmap
    const allDaily = output.providers.flatMap((p) => p.daily);
    if (allDaily.length > 0) {
      sections.push(
        text(PADDING, y, 'Activity', {
          fill: theme.foreground,
          'font-size': FONT_SIZE_SUBTITLE,
          'font-family': FONT_FAMILY,
          'font-weight': 'bold',
        }),
      );
      y += 16;

      const heatmap = renderHeatmap(allDaily, theme, {
        startDate: output.dateRange.since,
        endDate: output.dateRange.until,
      });
      sections.push(
        group([heatmap.svg], `translate(${PADDING}, ${y})`),
      );
      sectionWidths.push(heatmap.width);
      y += heatmap.height + SECTION_GAP;
    }

    // Stats panel
    sections.push(
      text(PADDING, y, 'Statistics', {
        fill: theme.foreground,
        'font-size': FONT_SIZE_SUBTITLE,
        'font-family': FONT_FAMILY,
        'font-weight': 'bold',
      }),
    );
    y += 16;

    const stats = renderStatsPanel(output.aggregated, theme);
    sections.push(
      group([stats.svg], `translate(${PADDING}, ${y})`),
    );
    sectionWidths.push(stats.width);
    y += stats.height + SECTION_GAP;

    // Day of week chart
    if (output.aggregated.dayOfWeek.length > 0) {
      sections.push(
        text(PADDING, y, 'Day of Week', {
          fill: theme.foreground,
          'font-size': FONT_SIZE_SUBTITLE,
          'font-family': FONT_FAMILY,
          'font-weight': 'bold',
        }),
      );
      y += 16;

      const dowChart = renderDayOfWeekChart(output.aggregated.dayOfWeek, theme);
      sections.push(
        group([dowChart.svg], `translate(${PADDING}, ${y})`),
      );
      sectionWidths.push(dowChart.width);
      y += dowChart.height + SECTION_GAP;
    }

    // Top models chart
    if (output.aggregated.topModels.length > 0) {
      sections.push(
        text(PADDING, y, 'Top Models', {
          fill: theme.foreground,
          'font-size': FONT_SIZE_SUBTITLE,
          'font-family': FONT_FAMILY,
          'font-weight': 'bold',
        }),
      );
      y += 16;

      const modelChart = renderModelChart(output.aggregated.topModels, theme);
      sections.push(
        group([modelChart.svg], `translate(${PADDING}, ${y})`),
      );
      sectionWidths.push(modelChart.width);
      y += modelChart.height + SECTION_GAP;
    }

    // Insights panel (optional)
    if (options.showInsights) {
      sections.push(
        text(PADDING, y, 'Insights', {
          fill: theme.foreground,
          'font-size': FONT_SIZE_SUBTITLE,
          'font-family': FONT_FAMILY,
          'font-weight': 'bold',
        }),
      );
      y += 16;

      const insights = renderInsightsPanel(
        output.aggregated,
        output.providers,
        theme,
      );
      sections.push(
        group([insights.svg], `translate(${PADDING}, ${y})`),
      );
      sectionWidths.push(insights.width);
      y += insights.height + SECTION_GAP;
    }

    const totalHeight = y + PADDING;
    // SVG width = widest section + padding on both sides, with a minimum floor
    const maxContentWidth = sectionWidths.length > 0
      ? Math.max(...sectionWidths)
      : MIN_SVG_WIDTH - PADDING * 2;
    const svgWidth = Math.max(maxContentWidth + PADDING * 2, MIN_SVG_WIDTH);

    // Assemble the full SVG
    const svgContent = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${totalHeight}" viewBox="0 0 ${svgWidth} ${totalHeight}">`,
      rect(0, 0, svgWidth, totalHeight, theme.background, 8),
      ...sections,
      '</svg>',
    ].join('\n');

    return svgContent;
  }
}
