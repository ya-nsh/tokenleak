import { Box, Text } from '@opentui/core';
import type { CacheEconomics, CacheRoiMetrics } from '@tokenleak/core';
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

/** Cache economics panel */
export function createCacheEconomicsPanel(cache: CacheEconomics) {
  const reuseStr = cache.reuseRatio !== null ? `${cache.reuseRatio.toFixed(1)}x` : 'N/A';

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.cyan,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' CACHE ECONOMICS ', fg: COLORS.cyan, attributes: BOLD }),
    statRow('Read Tokens', formatTokens(cache.readTokens)),
    statRow('Write Tokens', formatTokens(cache.writeTokens)),
    statRow('Read Coverage', `${(cache.readCoverage * 100).toFixed(1)}%`, COLORS.amber),
    statRow('Reuse Ratio', reuseStr),
  );
}

/** Cache ROI panel */
export function createCacheRoiPanel(roi: CacheRoiMetrics | null | undefined) {
  if (!roi) {
    return Box(
      {
        flexDirection: 'column',
        borderStyle: 'single',
        borderColor: COLORS.green,
        padding: 1,
        flexGrow: 1,
      },
      Text({ content: ' CACHE ROI ', fg: COLORS.green, attributes: BOLD }),
      Text({ content: 'Insufficient data for ROI calculation', fg: COLORS.dimWhite }),
    );
  }

  const { summary } = roi;
  const paybackStr = summary.paybackRatio !== null ? `${summary.paybackRatio.toFixed(1)}x` : 'N/A';

  return Box(
    {
      flexDirection: 'column',
      borderStyle: 'single',
      borderColor: COLORS.green,
      padding: 1,
      flexGrow: 1,
    },
    Text({ content: ' CACHE ROI ', fg: COLORS.green, attributes: BOLD }),
    statRow('Read Savings', formatCost(summary.readSavings), COLORS.green),
    statRow('Write Cost', formatCost(summary.writeCost), COLORS.red),
    statRow('Net Savings', formatCost(summary.netSavings), summary.netSavings >= 0 ? COLORS.green : COLORS.red),
    statRow('Payback Ratio', paybackStr, COLORS.amber),
  );
}
