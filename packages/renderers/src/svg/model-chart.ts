import type { TopModelEntry } from '@tokenleak/core';
import type { SvgTheme } from './theme';
import {
  BAR_HEIGHT,
  BAR_GAP,
  BAR_LABEL_WIDTH,
  FONT_SIZE_SMALL,
  FONT_FAMILY,
} from './layout';
import { rect, text, group, formatNumber } from './utils';

/** Render a horizontal bar chart for top models by token usage */
export function renderModelChart(
  topModels: TopModelEntry[],
  theme: SvgTheme,
): { svg: string; width: number; height: number } {
  const chartWidth = 360;
  const barAreaWidth = chartWidth - BAR_LABEL_WIDTH;
  const maxTokens = Math.max(...topModels.map((m) => m.tokens), 1);

  const children: string[] = [];

  for (let i = 0; i < topModels.length; i++) {
    const entry = topModels[i];
    if (!entry) continue;

    const y = i * (BAR_HEIGHT + BAR_GAP);
    const barWidth = Math.max((entry.tokens / maxTokens) * barAreaWidth, 0);

    // Model name label (truncate if too long)
    const label = entry.model.length > 18
      ? entry.model.slice(0, 17) + '\u2026'
      : entry.model;
    children.push(
      text(0, y + BAR_HEIGHT - 4, label, {
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
        rect(BAR_LABEL_WIDTH, y, barWidth, BAR_HEIGHT, theme.accentSecondary, 3),
      );
    }

    // Value + percentage
    const pct = entry.percentage * 100;
    const valueStr = `${formatNumber(entry.tokens)} (${pct.toFixed(1)}%)`;
    children.push(
      text(BAR_LABEL_WIDTH + barAreaWidth + 8, y + BAR_HEIGHT - 4, valueStr, {
        fill: theme.foreground,
        'font-size': FONT_SIZE_SMALL,
        'font-family': FONT_FAMILY,
      }),
    );
  }

  const height = Math.max(topModels.length * (BAR_HEIGHT + BAR_GAP), BAR_HEIGHT);
  const width = chartWidth + 100;

  return { svg: group(children), width, height };
}
