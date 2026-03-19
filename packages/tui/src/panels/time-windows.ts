import { Box, Text } from '@opentui/core';
import type { TimeWindowData } from '../lib/data.js';
import { formatTokens, formatCost, padLeft, padRight } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';

interface TimeWindowsProps {
  windows: TimeWindowData[];
}

function headerRow(labels: string[]) {
  const COL_W = 12;
  return Box(
    { flexDirection: 'row', width: '100%' },
    Text({ content: padRight('Metric', 18), fg: COLORS.amber, attributes: BOLD }),
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
  const COL_W = 12;
  return Box(
    { flexDirection: 'row', width: '100%' },
    Text({ content: padRight(label, 18), fg: COLORS.dimWhite }),
    ...values.map((v, i) =>
      Text({
        content: padLeft(v, COL_W),
        fg: highlights[i] ? COLORS.amber : COLORS.green,
        attributes: highlights[i] ? BOLD : undefined,
      }),
    ),
  );
}

function findMaxIndex(values: number[]): boolean[] {
  const max = Math.max(...values);
  return values.map((v) => v === max && v > 0);
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
      Text({ content: '\u2500'.repeat(66), fg: COLORS.dimWhite }),
      dataRow(
        'Tokens',
        tokenValues.map(formatTokens),
        findMaxIndex(tokenValues),
      ),
      dataRow(
        'Cost',
        costValues.map(formatCost),
        findMaxIndex(costValues),
      ),
      dataRow(
        'Avg Daily Tokens',
        avgTokenValues.map(formatTokens),
        findMaxIndex(avgTokenValues),
      ),
      dataRow(
        'Avg Daily Cost',
        avgCostValues.map(formatCost),
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
