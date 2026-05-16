import { Box, Text } from '@opentui/core';
import type { RoutingSimulationReport } from '@tokenleak/core';
import { COLORS, BOLD } from '../lib/theme.js';
import { formatCost, formatTokens, truncate } from '../lib/format.js';

export function createSimulatorPanel(report: RoutingSimulationReport | null) {
  if (!report) {
    return Box(
      { flexDirection: 'column', width: '100%', flexGrow: 1, borderStyle: 'single', borderColor: COLORS.dimWhite, paddingLeft: 1 },
      Text({ content: ' Routing Simulator ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: 'No event data available for routing simulation', fg: COLORS.dimWhite }),
    );
  }

  const candidates = report.candidates.filter((candidate) => (candidate.savings ?? 0) > 0).slice(0, 8);
  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1, borderStyle: 'single', borderColor: COLORS.dimWhite, paddingLeft: 1, paddingRight: 1 },
    Text({ content: ' Routing Simulator ', fg: COLORS.amber, attributes: BOLD }),
    Text({
      content: ` Current ${formatCost(report.currentCost)}  ->  Simulated ${formatCost(report.simulatedCost)}  |  Savings ${formatCost(report.estimatedSavings)} (${(report.estimatedSavingsPercent * 100).toFixed(1)}%)`,
      fg: COLORS.green,
      attributes: BOLD,
    }),
    Text({ content: ` Affected ${report.affectedEvents} events / ${formatTokens(report.affectedTokens)} tokens  |  Strategy ${report.strategy}`, fg: COLORS.dimWhite }),
    Text({ content: '', fg: COLORS.dimWhite }),
    Text({ content: ' Top Candidates ', fg: COLORS.amber, attributes: BOLD }),
    ...(candidates.length > 0
      ? candidates.flatMap((candidate) => [
          Text({
            content: `  ${truncate(candidate.fromModel, 22)} -> ${truncate(candidate.toModel, 22)}  ${formatCost(candidate.savings ?? 0)}  [${candidate.confidence}]`,
            fg: COLORS.white,
          }),
          Text({ content: `    ${truncate(candidate.reasons.join(', '), 72)}`, fg: COLORS.dimWhite }),
        ])
      : [Text({ content: '  No positive routing candidates found', fg: COLORS.dimWhite })]),
    ...(report.warnings.length > 0
      ? [
          Text({ content: '', fg: COLORS.dimWhite }),
          Text({ content: ` Warnings: ${truncate(report.warnings.slice(0, 2).join(' | '), 74)}`, fg: COLORS.dimWhite }),
        ]
      : []),
  );
}
