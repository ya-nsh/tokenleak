import { Box, Text } from '@opentui/core';
import type { DailyUsage } from '@tokenleak/core';
import { buildChart } from '../lib/chart.js';
import { COLORS, BOLD } from '../lib/theme.js';
import type { AppState } from '../lib/state.js';

export function createChartPanel(state: AppState, daily: DailyUsage[]) {
  if (state.isLoading) {
    return Box(
      {
        flexDirection: 'column',
        border: true,
        borderStyle: 'single',
        borderColor: COLORS.dimWhite,
        padding: 1,
        width: '100%',
        height: 14,
        title: ' Tokens per Day ',
      },
      Text({ content: 'Loading chart data...', fg: COLORS.dimWhite }),
    );
  }

  const chartContent = buildChart(daily, 70, 8);

  return Box(
    {
      flexDirection: 'column',
      border: true,
      borderStyle: 'single',
      borderColor: COLORS.amber,
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 2,
      width: '100%',
      height: 16,
      title: ' Tokens per Day ',
    },
    chartContent,
  );
}
