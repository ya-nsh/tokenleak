import type { DailyUsage } from '@tokenleak/core';
import { Box, Text } from '@opentui/core';
import { formatTokens, truncate } from './format.js';
import { COLORS, BOLD, MODEL_COLORS } from './theme.js';

interface ChartModel {
  model: string;
  color: string;
}

/** Build a unicode stacked bar chart from daily usage data */
export function buildChart(
  daily: DailyUsage[],
  chartWidth: number,
  chartHeight: number,
): ReturnType<typeof Box> {
  if (daily.length === 0) {
    return Box(
      { flexDirection: 'column', width: '100%' },
      Text({ content: 'No data for this period', fg: COLORS.dimWhite }),
    );
  }

  // Determine top models across all days for color assignment
  const modelTotals = new Map<string, number>();
  for (const day of daily) {
    for (const m of day.models) {
      modelTotals.set(m.model, (modelTotals.get(m.model) ?? 0) + m.totalTokens);
    }
  }

  const sortedModels = [...modelTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topModelNames = new Set(sortedModels.map(([name]) => name));
  const chartModels: ChartModel[] = sortedModels.map(([name], i) => ({
    model: name,
    color: MODEL_COLORS[i % MODEL_COLORS.length]!,
  }));

  // If width is too narrow, show a simple text list
  if (chartWidth < 40) {
    return buildCompactList(daily, chartModels);
  }

  const maxTokens = Math.max(...daily.map((d) => d.totalTokens), 1);
  const yAxisWidth = 8;
  const barAreaWidth = Math.max(chartWidth - yAxisWidth - 2, 10);

  // Sample days to fit the bar area (1 char per bar + 1 gap)
  const maxBars = Math.floor(barAreaWidth / 2);
  const step = daily.length > maxBars ? Math.ceil(daily.length / maxBars) : 1;
  const sampledDays: DailyUsage[] = [];
  for (let i = 0; i < daily.length; i += step) {
    sampledDays.push(daily[i]!);
  }

  // Build chart rows from top to bottom
  const rows: ReturnType<typeof Box>[] = [];

  for (let row = chartHeight - 1; row >= 0; row--) {
    const threshold = (row / chartHeight) * maxTokens;
    let yLabel = '';
    if (row === chartHeight - 1) {
      yLabel = formatTokens(maxTokens);
    } else if (row === 0) {
      yLabel = '0';
    } else if (row === Math.floor(chartHeight / 2)) {
      yLabel = formatTokens(maxTokens / 2);
    }

    const labelPadded = yLabel.padStart(yAxisWidth - 1) + '\u2502';

    // Build bar characters for this row
    let barStr = '';
    for (const day of sampledDays) {
      if (day.totalTokens > threshold) {
        // Find which model segment this row falls in
        const color = getSegmentColor(day, threshold, maxTokens, chartHeight, row, topModelNames, chartModels);
        // We can't color individual chars in a single Text, so use block char
        barStr += '\u2588 ';
      } else {
        barStr += '  ';
      }
    }

    rows.push(
      Box(
        { flexDirection: 'row', width: '100%', height: 1 },
        Text({ content: labelPadded, fg: COLORS.dimWhite }),
        Text({ content: barStr, fg: COLORS.green }),
      ),
    );
  }

  // X-axis line
  const xLine = '\u2500'.repeat(Math.min(sampledDays.length * 2, barAreaWidth));
  rows.push(
    Box(
      { flexDirection: 'row', width: '100%', height: 1 },
      Text({ content: ' '.repeat(yAxisWidth), fg: COLORS.dimWhite }),
      Text({ content: xLine, fg: COLORS.dimWhite }),
    ),
  );

  // X-axis labels
  const xLabels = buildXLabels(sampledDays, barAreaWidth);
  rows.push(
    Box(
      { flexDirection: 'row', width: '100%', height: 1 },
      Text({ content: ' '.repeat(yAxisWidth), fg: COLORS.dimWhite }),
      Text({ content: xLabels, fg: COLORS.dimWhite }),
    ),
  );

  // Spacer before legend
  rows.push(
    Box({ width: '100%', height: 1 }),
  );

  // Legend
  const legendParts: ReturnType<typeof Text>[] = [];
  for (const cm of chartModels) {
    legendParts.push(Text({ content: `\u25cf ${truncate(cm.model, 18)}  `, fg: cm.color }));
  }

  rows.push(
    Box(
      { flexDirection: 'row', width: '100%', height: 1 },
      Text({ content: ' '.repeat(yAxisWidth), fg: COLORS.dimWhite }),
      ...legendParts,
    ),
  );

  return Box(
    { flexDirection: 'column', width: '100%' },
    ...rows,
  );
}

function getSegmentColor(
  _day: DailyUsage,
  _threshold: number,
  _maxTokens: number,
  _chartHeight: number,
  _row: number,
  _topModelNames: Set<string>,
  chartModels: ChartModel[],
): string {
  // Simplified: use the top model's color for the bar
  return chartModels[0]?.color ?? COLORS.green;
}

function buildXLabels(days: DailyUsage[], width: number): string {
  if (days.length === 0) return '';

  const labelCount = Math.min(4, days.length);
  const positions = [];
  for (let i = 0; i < labelCount; i++) {
    positions.push(Math.floor((i / (labelCount - 1 || 1)) * (days.length - 1)));
  }

  let result = '';
  let pos = 0;
  for (const idx of positions) {
    const targetPos = idx * 2;
    while (pos < targetPos && pos < width) {
      result += ' ';
      pos++;
    }
    const label = formatShortDate(days[idx]!.date);
    result += label;
    pos += label.length;
  }

  return result.slice(0, width);
}

/** Format a date string as "Mon DD" (e.g., "Mar 15") */
export function formatShortDate(dateStr: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parts = dateStr.split('-');
  const month = months[parseInt(parts[1]!, 10) - 1] ?? 'Jan';
  const day = parseInt(parts[2]!, 10);
  return `${month} ${day}`;
}

function buildCompactList(
  daily: DailyUsage[],
  chartModels: ChartModel[],
): ReturnType<typeof Box> {
  // Sort by tokens descending, show top 5 days
  const sorted = [...daily].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 5);
  const rows = sorted.map((d) =>
    Box(
      { flexDirection: 'row', width: '100%' },
      Text({ content: `${formatShortDate(d.date)}  `, fg: COLORS.dimWhite }),
      Text({ content: formatTokens(d.totalTokens), fg: COLORS.green, attributes: BOLD }),
    ),
  );

  const legendParts = chartModels.map((cm) =>
    Text({ content: `\u25cf ${cm.model}  `, fg: cm.color }),
  );

  return Box(
    { flexDirection: 'column', width: '100%' },
    Text({ content: 'Top 5 Days', fg: COLORS.amber, attributes: BOLD }),
    ...rows,
    Box({ flexDirection: 'row', width: '100%', paddingTop: 1 }, ...legendParts),
  );
}
