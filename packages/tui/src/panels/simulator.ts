import { Box, Text } from '@opentui/core';
import type { RoutingSimulationCandidate, RoutingSimulationReport } from '@tokenleak/core';
import { COLORS, BOLD } from '../lib/theme.js';
import { formatCost, formatTokens, truncate, wrapText } from '../lib/format.js';

export const SIMULATOR_VISIBLE_ROWS = 8;
export const SIMULATOR_MAX_CONTENT_WIDTH = 78;

function clampOffset(offset: number, itemCount: number): number {
  return Math.max(0, Math.min(offset, Math.max(0, itemCount - SIMULATOR_VISIBLE_ROWS)));
}

function candidateAction(candidate: RoutingSimulationCandidate): string {
  if (candidate.ruleId === 'premium-short-output') {
    return `Use ${candidate.toModel} instead of ${candidate.fromModel} for small answers`;
  }
  if (candidate.ruleId === 'quick-lookup') {
    return `Use ${candidate.toModel} instead of ${candidate.fromModel} for quick lookups`;
  }
  if (candidate.ruleId === 'low-output-ratio') {
    return `Use ${candidate.toModel} instead of ${candidate.fromModel} for low-output turns`;
  }
  return `Use ${candidate.toModel} instead of ${candidate.fromModel}`;
}

function candidateDetail(candidate: RoutingSimulationCandidate): string {
  const details: string[] = [];
  if (candidate.reasons.some((reason) => reason.toLowerCase().includes('cache'))) {
    details.push('includes cache pricing');
  }
  return details.join(' · ');
}

export function createSimulatorPanel(
  report: RoutingSimulationReport | null,
  scrollOffset: number = 0,
  contentWidth: number = SIMULATOR_MAX_CONTENT_WIDTH,
) {
  const width = Math.max(36, contentWidth);
  if (!report) {
    return Box(
      { flexDirection: 'column', width: '100%', flexGrow: 1, borderStyle: 'single', borderColor: COLORS.dimWhite, paddingLeft: 1 },
      Text({ content: ' Routing Simulator ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: 'No event data available for routing simulation', fg: COLORS.dimWhite }),
    );
  }

  const positiveCandidates = report.candidates.filter((candidate) => (candidate.savings ?? 0) > 0);
  const offset = clampOffset(scrollOffset, positiveCandidates.length);
  const candidates = positiveCandidates.slice(offset, offset + SIMULATOR_VISIBLE_ROWS);
  const below = positiveCandidates.length - offset - candidates.length;
  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1, borderStyle: 'single', borderColor: COLORS.dimWhite, paddingLeft: 1, paddingRight: 1 },
    Text({ content: ' Routing Simulator ', fg: COLORS.amber, attributes: BOLD }),
    Text({
      content: truncate(` Actual spend ${formatCost(report.currentCost)}  ->  Estimated with routing ${formatCost(report.simulatedCost)}`, width),
      fg: COLORS.green,
      attributes: BOLD,
    }),
    Text({
      content: truncate(` Savings ${formatCost(report.estimatedSavings)} (${(report.estimatedSavingsPercent * 100).toFixed(1)}%)`, width),
      fg: COLORS.green,
      attributes: BOLD,
    }),
    Text({ content: truncate(` Could reroute ${report.affectedEvents} events / ${formatTokens(report.affectedTokens)} tokens  |  Strategy ${report.strategy}`, width), fg: COLORS.dimWhite }),
    Text({ content: '', fg: COLORS.dimWhite }),
    Text({ content: ' Top Candidates ', fg: COLORS.amber, attributes: BOLD }),
    ...(offset > 0 ? [Text({ content: ` ${offset} more above`, fg: COLORS.dimWhite })] : []),
    ...(candidates.length > 0
      ? candidates.flatMap((candidate) => {
          const detail = candidateDetail(candidate);
          return [
            Text({
              content: truncate(`  ${candidateAction(candidate)}`, width),
              fg: COLORS.white,
            }),
            Text({
              content: truncate(`    Save about ${formatCost(candidate.savings ?? 0)} on this event · confidence: ${candidate.confidence}`, width),
              fg: COLORS.dimWhite,
            }),
            ...(detail
              ? wrapText(detail, Math.max(16, width - 4), 1).map((line) =>
                  Text({ content: truncate(`    ${line}`, width), fg: COLORS.dimWhite }),
                )
              : []),
          ];
        })
      : [Text({ content: '  No positive routing candidates found', fg: COLORS.dimWhite })]),
    ...(below > 0 ? [Text({ content: ` ${below} more below`, fg: COLORS.dimWhite })] : []),
    ...(report.warnings.length > 0
      ? [
          Text({ content: '', fg: COLORS.dimWhite }),
          ...wrapText(`Warnings: ${report.warnings.slice(0, 2).join(' | ')}`, width, 2).map((line) =>
            Text({ content: truncate(` ${line}`, width), fg: COLORS.dimWhite }),
          ),
        ]
      : []),
  );
}
