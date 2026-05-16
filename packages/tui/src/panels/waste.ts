import { Box, Text } from '@opentui/core';
import type { AgentWasteReport } from '@tokenleak/core';
import { COLORS, BOLD } from '../lib/theme.js';
import { formatCost, formatTokens, truncate } from '../lib/format.js';

function severityColor(severity: 'high' | 'medium' | 'low'): string {
  if (severity === 'high') return COLORS.red;
  if (severity === 'medium') return COLORS.amber;
  return COLORS.dimWhite;
}

export function createWastePanel(report: AgentWasteReport | null) {
  if (!report) {
    return Box(
      { flexDirection: 'column', width: '100%', flexGrow: 1, borderStyle: 'single', borderColor: COLORS.dimWhite, paddingLeft: 1 },
      Text({ content: ' Waste Signals ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: 'No event data available for waste detection', fg: COLORS.dimWhite }),
    );
  }

  const signals = report.signals.slice(0, 8);
  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1, borderStyle: 'single', borderColor: COLORS.dimWhite, paddingLeft: 1, paddingRight: 1 },
    Text({ content: ' Waste Signals ', fg: COLORS.amber, attributes: BOLD }),
    Text({
      content: ` Signals ${report.summary.totalSignals}  High ${report.summary.highSeverity}  Est. savings ${report.summary.estimatedSavings === null ? '-' : formatCost(report.summary.estimatedSavings)}`,
      fg: COLORS.white,
      attributes: BOLD,
    }),
    Text({ content: ` Analyzed ${report.summary.analyzedEvents} events / ${report.summary.analyzedSessions} sessions`, fg: COLORS.dimWhite }),
    Text({ content: '', fg: COLORS.dimWhite }),
    ...(signals.length > 0
      ? signals.flatMap((signal) => [
          Text({
            content: `  [${signal.severity.toUpperCase()}] ${truncate(signal.title, 34)}  ${signal.estimatedSavings === null ? '-' : formatCost(signal.estimatedSavings)}  ${signal.confidence}`,
            fg: severityColor(signal.severity),
            attributes: BOLD,
          }),
          Text({ content: `    ${truncate(signal.evidence.reason, 72)}`, fg: COLORS.dimWhite }),
          Text({ content: `    ${formatTokens(signal.evidence.tokens)} tok  ${formatCost(signal.evidence.cost)}  ${signal.recipes[0]?.title ?? ''}`, fg: COLORS.cyan }),
        ])
      : [Text({ content: '  No deterministic waste signals detected', fg: COLORS.dimWhite })]),
    ...(report.warnings.length > 0
      ? [Text({ content: '', fg: COLORS.dimWhite }), Text({ content: ` Warnings: ${truncate(report.warnings.join(' | '), 74)}`, fg: COLORS.dimWhite })]
      : []),
  );
}
