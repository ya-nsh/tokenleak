import type { DayOfWeekEntry } from '@tokenleak/core';
import type { SvgTheme } from './theme';
import {
  BAR_HEIGHT,
  BAR_GAP,
  BAR_LABEL_WIDTH,
  FONT_SIZE_SMALL,
  FONT_FAMILY,
} from './layout';
import { rect, text, group, formatNumber } from './utils';

/** Render a horizontal bar chart for day-of-week token distribution */
export function renderDayOfWeekChart(
  dayOfWeek: DayOfWeekEntry[],
  theme: SvgTheme,
): { svg: string; width: number; height: number } {
  const chartWidth = 300;
  const barAreaWidth = chartWidth - BAR_LABEL_WIDTH;
  const maxTokens = Math.max(...dayOfWeek.map((d) => d.tokens), 1);

  const children: string[] = [];

  for (let i = 0; i < dayOfWeek.length; i++) {
    const entry = dayOfWeek[i];
    if (!entry) continue;

    const y = i * (BAR_HEIGHT + BAR_GAP);
    const barWidth = Math.max((entry.tokens / maxTokens) * barAreaWidth, 0);

    // Label
    children.push(
      text(0, y + BAR_HEIGHT - 4, entry.label, {
        fill: theme.muted,
        'font-size': FONT_SIZE_SMALL,
        'font-family': FONT_FAMILY,
      }),
    );

    // Background bar
    children.push(
      rect(BAR_LABEL_WIDTH, y, barAreaWidth, BAR_HEIGHT, theme.barBackground, 3),
    );

    // Filled bar
    if (barWidth > 0) {
      children.push(
        rect(BAR_LABEL_WIDTH, y, barWidth, BAR_HEIGHT, theme.barFill, 3),
      );
    }

    // Value label
    children.push(
      text(BAR_LABEL_WIDTH + barAreaWidth + 8, y + BAR_HEIGHT - 4, formatNumber(entry.tokens), {
        fill: theme.foreground,
        'font-size': FONT_SIZE_SMALL,
        'font-family': FONT_FAMILY,
      }),
    );
  }

  const height = dayOfWeek.length * (BAR_HEIGHT + BAR_GAP);
  const width = chartWidth + 60;

  return { svg: group(children), width, height };
}
