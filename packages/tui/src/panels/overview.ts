import { Box, Text } from '@opentui/core';
import type { AggregatedStats, ProviderData } from '@tokenleak/core';
import { formatTokens, formatCost, formatPercent } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';

interface OverviewProps {
  stats: AggregatedStats | null;
  providers: ProviderData[];
}

function statRow(label: string, value: string, valueColor: string = COLORS.green) {
  return Box(
    { flexDirection: 'row', width: '100%' },
    Text({ content: label, fg: COLORS.dimWhite }),
    Text({ content: '  ' }),
    Text({ content: value, fg: valueColor, attributes: BOLD }),
  );
}

export function createOverviewPanel(props: OverviewProps) {
  const { stats, providers } = props;

  const children: ReturnType<typeof Box | typeof Text>[] = [];

  if (!stats) {
    children.push(
      Text({ content: 'Loading...', fg: COLORS.amber }),
    );
  } else {
    children.push(
      statRow('Total Tokens', formatTokens(stats.totalTokens)),
      statRow('Total Cost', formatCost(stats.totalCost), COLORS.amber),
      statRow('Active / Total Days', `${stats.activeDays} / ${stats.totalDays}`),
      statRow('Current Streak', `${stats.currentStreak}d`),
      statRow('Longest Streak', `${stats.longestStreak}d`),
      statRow('Cache Hit Rate', formatPercent(stats.cacheHitRate), COLORS.cyan),
      statRow('Avg Daily Tokens', formatTokens(stats.averageDailyTokens)),
      statRow('Avg Daily Cost', formatCost(stats.averageDailyCost), COLORS.amber),
      statRow('Providers', `${providers.length} active`),
      statRow('Peak Day', stats.peakDay ? `${stats.peakDay.date} (${formatTokens(stats.peakDay.tokens)})` : 'N/A'),
      statRow('Input Tokens', formatTokens(stats.totalInputTokens)),
      statRow('Output Tokens', formatTokens(stats.totalOutputTokens)),
    );
  }

  return Box(
    {
      flexDirection: 'column',
      border: true,
      borderStyle: 'single',
      borderColor: COLORS.amber,
      padding: 1,
      flexGrow: 1,
      title: ' OVERVIEW ',
    },
    ...children,
  );
}
