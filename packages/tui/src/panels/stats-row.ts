import { Box, Text } from '@opentui/core';
import type { AggregatedStats } from '@tokenleak/core';
import { formatTokens, formatCost, formatPercent } from '../lib/format.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

function statCard(label: string, value: string, valueColor: string) {
  return Box(
    { flexDirection: 'row' },
    Text({ content: `${label}  `, fg: COLORS.dimWhite }),
    Text({ content: value, fg: valueColor, attributes: BOLD }),
  );
}

function sep() {
  return Text({ content: ' \u2502 ', fg: COLORS.dimWhite });
}

export function createStatsRow(state: AppState, stats: AggregatedStats | null) {
  if (state.isLoading || !stats) {
    return Box(
      {
        flexDirection: 'row',
        width: '100%',
        paddingLeft: 2,
        paddingRight: 2,
        height: 1,
        justifyContent: 'flex-start',
        gap: 0,
      },
      statCard('Tokens', '---', COLORS.dimWhite),
      sep(),
      statCard('Cost', '---', COLORS.dimWhite),
      sep(),
      statCard('Active', '---', COLORS.dimWhite),
      sep(),
      statCard('Streak', '---', COLORS.dimWhite),
      sep(),
      statCard('Cache', '---', COLORS.dimWhite),
    );
  }

  return Box(
    {
      flexDirection: 'row',
      width: '100%',
      paddingLeft: 2,
      paddingRight: 2,
      height: 1,
      justifyContent: 'flex-start',
      gap: 0,
    },
    statCard('Tokens', formatTokens(stats.totalTokens), COLORS.green),
    sep(),
    statCard('Cost', formatCost(stats.totalCost), COLORS.amber),
    sep(),
    statCard('Active', `${stats.activeDays}/${stats.totalDays}d`, COLORS.cyan),
    sep(),
    statCard('Streak', `${stats.currentStreak}d`, COLORS.green),
    sep(),
    statCard('Cache', formatPercent(stats.cacheHitRate), COLORS.cyan),
  );
}
