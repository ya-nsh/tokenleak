import { Box, Text } from '@opentui/core';
import type { InputOutputMetrics, MonthlyBurnMetrics } from '@tokenleak/core';
import { COLORS, BOLD } from '../lib/theme.js';
import { formatTokens, formatCost } from '../lib/format.js';

/** Stat row helper */
function statRow(label: string, value: string, valueColor: string = COLORS.green) {
  return Box(
    { flexDirection: 'row', width: '100%' },
    Text({ content: label, fg: COLORS.dimWhite }),
    Text({ content: '  ' }),
    Text({ content: value, fg: valueColor, attributes: BOLD }),
  );
}

/** Input/Output ratio panel */
export function createInputOutputPanel(io: InputOutputMetrics, stats: { totalInputTokens: number; totalOutputTokens: number }) {
  const total = stats.totalInputTokens + stats.totalOutputTokens;
  const inputPct = total > 0 ? ((stats.totalInputTokens / total) * 100).toFixed(1) : '0.0';
  const outputPct = total > 0 ? ((stats.totalOutputTokens / total) * 100).toFixed(1) : '0.0';
  const ioRatio = io.inputPerOutput !== null ? io.inputPerOutput.toFixed(1) : 'N/A';

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.cyan,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' INPUT / OUTPUT ', fg: COLORS.cyan, attributes: BOLD }),
    statRow('Input', `${formatTokens(stats.totalInputTokens)}  (${inputPct}%)`),
    statRow('Output', `${formatTokens(stats.totalOutputTokens)}  (${outputPct}%)`),
    statRow('I/O Ratio', `${ioRatio}:1`),
    statRow('Output Share', `${(io.outputShare * 100).toFixed(1)}%`, COLORS.amber),
  );
}

/** Monthly burn projection panel */
export function createMonthlyBurnPanel(burn: MonthlyBurnMetrics) {
  const burnRate = burn.observedDays > 0
    ? formatCost(burn.projectedCost / (burn.calendarDays || 30))
    : '$0.00';

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.amber,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' MONTHLY BURN ', fg: COLORS.amber, attributes: BOLD }),
    statRow('Projected Tokens', formatTokens(burn.projectedTokens)),
    statRow('Projected Cost', formatCost(burn.projectedCost), COLORS.amber),
    statRow('Observed', `${burn.observedDays}/${burn.calendarDays} days`),
    statRow('Burn Rate', `${burnRate}/day`, COLORS.red),
  );
}
