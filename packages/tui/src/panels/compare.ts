import { Box, Text } from '@opentui/core';
import type { CompareOutput } from '@tokenleak/core';
import { formatCostWithCompleteness, formatTokens, formatPercent, formatShortDate, padRight, padLeft } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';
import { WINDOW_LABELS } from '../lib/state.js';

function relativeDelta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? '+0.0%' : 'New';
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function deltaArrow(value: number): string {
  return value >= 0 ? '\u25B2' : '\u25BC';
}

interface MetricRow {
  label: string;
  current: string;
  previous: string;
  delta: number;
  deltaLabel: string;
  invertColor: boolean; // true = increase is bad (cost), false = increase is good
}

function buildMetricRows(output: CompareOutput): MetricRow[] {
  // periodA = previous range, periodB = current range (from ensureCompareOutput)
  // Deltas are absolute current minus previous values.
  const a = output.periodB.stats; // current
  const b = output.periodA.stats; // previous
  const d = output.deltas;

  return [
    {
      label: 'Tokens',
      current: formatTokens(a.totalTokens),
      previous: formatTokens(b.totalTokens),
      delta: d.tokens,
      deltaLabel: `${deltaArrow(d.tokens)} ${relativeDelta(a.totalTokens, b.totalTokens)}`,
      invertColor: false,
    },
    {
      label: 'Cost',
      current: formatCostWithCompleteness(a.totalCost, a.costCompleteness),
      previous: formatCostWithCompleteness(b.totalCost, b.costCompleteness),
      delta: d.cost,
      deltaLabel: [a, b].some((stats) => stats.costCompleteness && stats.costCompleteness.status !== 'complete')
        ? 'Unknown' : `${deltaArrow(d.cost)} ${relativeDelta(a.totalCost, b.totalCost)}`,
      invertColor: true,
    },
    {
      label: 'Active Days',
      current: `${a.activeDays}`,
      previous: `${b.activeDays}`,
      delta: d.activeDays,
      deltaLabel: `${deltaArrow(d.activeDays)} ${d.activeDays >= 0 ? '+' : ''}${d.activeDays}`,
      invertColor: false,
    },
    {
      label: 'Avg Daily Tokens',
      current: formatTokens(a.averageDailyTokens),
      previous: formatTokens(b.averageDailyTokens),
      delta: d.averageDailyTokens,
      deltaLabel: `${deltaArrow(d.averageDailyTokens)} ${relativeDelta(a.averageDailyTokens, b.averageDailyTokens)}`,
      invertColor: false,
    },
    {
      label: 'Cache Hit Rate',
      current: formatPercent(a.cacheHitRate),
      previous: formatPercent(b.cacheHitRate),
      delta: d.cacheHitRate,
      deltaLabel: `${deltaArrow(d.cacheHitRate)} ${d.cacheHitRate >= 0 ? '+' : ''}${(d.cacheHitRate * 100).toFixed(1)}pp`,
      invertColor: false,
    },
    {
      label: 'Current Streak',
      current: `${a.currentStreak}d`,
      previous: `${b.currentStreak}d`,
      delta: d.streak,
      deltaLabel: `${deltaArrow(d.streak)} ${d.streak >= 0 ? '+' : ''}${d.streak}d`,
      invertColor: false,
    },
  ];
}

function renderMetricRow(row: MetricRow) {
  const isPositive = row.delta >= 0;
  const deltaColor = row.invertColor
    ? (isPositive ? COLORS.red : COLORS.green)
    : (isPositive ? COLORS.green : COLORS.red);

  return Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: padRight(row.label, 20), fg: COLORS.white }),
    Text({ content: padLeft(row.current, 14), fg: COLORS.green }),
    Text({ content: padLeft(row.previous, 14), fg: COLORS.dimWhite }),
    Text({ content: padLeft(row.deltaLabel, 18), fg: deltaColor }),
  );
}

export function createComparePanel(state: AppState, output: CompareOutput | null) {
  const windowLabel = WINDOW_LABELS[state.selectedWindowIndex] ?? 'ALL';

  if (!output) {
    return Box(
      {
        flexDirection: 'column',
        width: '100%',
        flexGrow: 1,
        borderStyle: 'single',
        borderColor: COLORS.dimWhite,
        paddingLeft: 1,
        paddingRight: 1,
      },
      Text({ content: ` Compare: ${windowLabel} `, fg: COLORS.amber, attributes: BOLD }),
      Text({ content: '', fg: COLORS.dimWhite }),
      Text({ content: 'No data available for comparison', fg: COLORS.dimWhite }),
    );
  }

  const currentLabel = `${formatShortDate(output.periodB.range.since)} \u2013 ${formatShortDate(output.periodB.range.until)}`;
  const previousLabel = `${formatShortDate(output.periodA.range.since)} \u2013 ${formatShortDate(output.periodA.range.until)}`;

  const metricRows = buildMetricRows(output);
  const offset = state.compareScrollOffset;
  const visible = metricRows.slice(offset);

  const headerRow = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: padRight('Metric', 20), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Current', 14), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Previous', 14), fg: COLORS.dimWhite }),
    Text({ content: padLeft('Delta', 18), fg: COLORS.dimWhite }),
  );

  const separator = Box(
    { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
    Text({ content: '\u2500'.repeat(66), fg: COLORS.dimWhite }),
  );

  return Box(
    {
      flexDirection: 'column',
      width: '100%',
      flexGrow: 1,
      borderStyle: 'single',
      borderColor: COLORS.dimWhite,
    },
    Text({ content: ` Compare: ${windowLabel} `, fg: COLORS.amber, attributes: BOLD }),
    Box(
      { flexDirection: 'row', width: '100%', paddingLeft: 1, paddingRight: 1 },
      Text({ content: `Current (${currentLabel})`, fg: COLORS.cyan }),
      Text({ content: '  vs  ', fg: COLORS.dimWhite }),
      Text({ content: `Previous (${previousLabel})`, fg: COLORS.dimWhite }),
    ),
    Text({ content: '', fg: COLORS.dimWhite }),
    headerRow,
    separator,
    ...visible.map(renderMetricRow),
  );
}
