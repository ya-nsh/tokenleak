import { Box, Text } from '@opentui/core';
import type { TimeWindowData } from '../lib/data.js';
import {
  formatTokens,
  formatCostWithCompleteness,
  padLeft,
  padRight,
} from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';

interface TimeWindowsProps {
  windows: TimeWindowData[];
}

/** Sized so five windows fit a half-width quadrant without wrapping values. */
const LABEL_W = 15;
const COL_W = 9;

function headerRow(labels: string[]) {
  return Box(
    { flexDirection: 'row', width: '100%' },
    Text({ content: padRight('Metric', LABEL_W), fg: COLORS.amber, attributes: BOLD }),
    ...labels.map((l) =>
      Text({ content: padLeft(l, COL_W), fg: COLORS.amber, attributes: BOLD }),
    ),
  );
}

function dataRow(
  label: string,
  values: string[],
  highlights: boolean[],
) {
  return Box(
    { flexDirection: 'row', width: '100%' },
    Text({ content: padRight(label, LABEL_W), fg: COLORS.dimWhite }),
    ...values.map((v, i) =>
      Text({
        content: padLeft(v, COL_W),
        flexShrink: 0,
        fg: highlights[i] ? COLORS.amber : COLORS.green,
        attributes: highlights[i] ? BOLD : undefined,
      }),
    ),
  );
}

function findMaxIndex(values: number[]): boolean[] {
  let maxVal = -Infinity;
  let maxIdx = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i]! > maxVal) {
      maxVal = values[i]!;
      maxIdx = i;
    }
  }
  return values.map((_, i) => i === maxIdx && maxVal > 0);
}

export function createTimeWindowsPanel(props: TimeWindowsProps) {
  const { windows } = props;

  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (windows.length === 0) {
    children.push(Text({ content: 'Loading...', fg: COLORS.amber }));
  } else {
    const labels = windows.map((w) => w.label);

    const tokenValues = windows.map((w) => w.stats.totalTokens);
    const costValues = windows.map((w) => w.stats.totalCost);
    const avgTokenValues = windows.map((w) => w.stats.averageDailyTokens);
    const avgCostValues = windows.map((w) => w.stats.averageDailyCost);
    const activeDaysValues = windows.map((w) => w.stats.activeDays);

    children.push(
      headerRow(labels),
      Text({ content: '\u2500'.repeat(LABEL_W + COL_W * labels.length), fg: COLORS.dimWhite }),
      dataRow(
        'Tokens',
        tokenValues.map(formatTokens),
        findMaxIndex(tokenValues),
      ),
      dataRow(
        'Cost',
        windows.map((w) => formatCostWithCompleteness(w.stats.totalCost, w.stats.costCompleteness)),
        findMaxIndex(costValues),
      ),
      dataRow(
        'Avg/Day Tokens',
        avgTokenValues.map(formatTokens),
        findMaxIndex(avgTokenValues),
      ),
      dataRow(
        'Avg/Day Cost',
        windows.map((w) =>
          formatCostWithCompleteness(w.stats.averageDailyCost, w.stats.costCompleteness),
        ),
        findMaxIndex(avgCostValues),
      ),
      dataRow(
        'Active Days',
        activeDaysValues.map((v) => v.toString()),
        findMaxIndex(activeDaysValues),
      ),
      dataRow(
        'Cache Hit Rate',
        windows.map((w) => `${(w.stats.cacheHitRate * 100).toFixed(1)}%`),
        findMaxIndex(windows.map((w) => w.stats.cacheHitRate)),
      ),
      dataRow(
        'Current Streak',
        windows.map((w) => `${w.stats.currentStreak}d`),
        findMaxIndex(windows.map((w) => w.stats.currentStreak)),
      ),
    );
  }

  return Box(
    {
      flexDirection: 'column',
      border: true,
      borderStyle: 'single',
      borderColor: COLORS.cyan,
      padding: 1,
      flexGrow: 1,
      title: ' TIME WINDOWS ',
    },
    ...children,
  );
}
