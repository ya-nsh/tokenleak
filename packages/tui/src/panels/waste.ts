import { Box, Text } from '@opentui/core';
import type { AgentWasteReport, AgentWasteSignal } from '@tokenleak/core';
import { COLORS, BOLD } from '../lib/theme.js';
import { formatCost, formatTokens, truncate, wrapText } from '../lib/format.js';

export const WASTE_VISIBLE_ROWS = 8;
export const WASTE_MAX_CONTENT_WIDTH = 78;

function severityColor(severity: 'high' | 'medium' | 'low'): string {
  if (severity === 'high') return COLORS.red;
  if (severity === 'medium') return COLORS.amber;
  return COLORS.dimWhite;
}

function shortSignalTitle(signal: AgentWasteSignal): string {
  if (signal.title === 'Repeated prompt cluster') return 'Repeated similar asks';
  if (signal.title === 'High context drag') return 'Too much context';
  return signal.title;
}

function shortRecipeTitle(title: string | undefined): string {
  if (title === 'Break the retry loop') return 'Change approach';
  if (title === 'Start a compact follow-up session') return 'Start fresh';
  return title ?? 'Review signal';
}

function readableReason(signal: AgentWasteSignal): string {
  const repeatMatch = signal.evidence.reason.match(/^(\d+)\s+similar prompts/i);
  if (signal.kind === 'prompt-repeat' && repeatMatch) {
    return `${repeatMatch[1]} similar asks repeated in this window.`;
  }
  return signal.evidence.reason;
}

function clampOffset(offset: number, itemCount: number): number {
  return Math.max(0, Math.min(offset, Math.max(0, itemCount - WASTE_VISIBLE_ROWS)));
}

export function createWastePanel(
  report: AgentWasteReport | null,
  scrollOffset: number = 0,
  contentWidth: number = WASTE_MAX_CONTENT_WIDTH,
) {
  const width = Math.max(36, contentWidth);
  if (!report) {
    return Box(
      { flexDirection: 'column', width: '100%', flexGrow: 1, borderStyle: 'single', borderColor: COLORS.dimWhite, paddingLeft: 1 },
      Text({ content: ' Waste Signals ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: 'No event data available for waste detection', fg: COLORS.dimWhite }),
    );
  }

  const offset = clampOffset(scrollOffset, report.signals.length);
  const signals = report.signals.slice(offset, offset + WASTE_VISIBLE_ROWS);
  const below = report.signals.length - offset - signals.length;
  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1, borderStyle: 'single', borderColor: COLORS.dimWhite, paddingLeft: 1, paddingRight: 1 },
    Text({ content: ' Waste Signals ', fg: COLORS.amber, attributes: BOLD }),
    Text({
      content: truncate(` Signals ${report.summary.totalSignals}  High ${report.summary.highSeverity}  Est. savings ${report.summary.estimatedSavings === null ? '-' : formatCost(report.summary.estimatedSavings)}`, width),
      fg: COLORS.white,
      attributes: BOLD,
    }),
    Text({ content: truncate(` Analyzed ${report.summary.analyzedEvents} events / ${report.summary.analyzedSessions} sessions`, width), fg: COLORS.dimWhite }),
    Text({ content: '', fg: COLORS.dimWhite }),
    ...(offset > 0 ? [Text({ content: ` ${offset} more above`, fg: COLORS.dimWhite })] : []),
    ...(signals.length > 0
      ? signals.flatMap((signal) => {
          const reasonLines = wrapText(readableReason(signal), Math.max(16, width - 4), 1);
          return [
            Text({
              content: truncate(`  [${signal.severity.toUpperCase()}] ${shortSignalTitle(signal)}  ${signal.estimatedSavings === null ? '-' : formatCost(signal.estimatedSavings)}  confidence: ${signal.confidence}`, width),
              fg: severityColor(signal.severity),
              attributes: BOLD,
            }),
            ...reasonLines.map((line) => Text({ content: truncate(`    ${line}`, width), fg: COLORS.dimWhite })),
            Text({
              content: truncate(`    ${formatTokens(signal.evidence.tokens)} tok  ${formatCost(signal.evidence.cost)}  ${shortRecipeTitle(signal.recipes[0]?.title)}`, width),
              fg: COLORS.cyan,
            }),
          ];
        })
      : [Text({ content: '  No deterministic waste signals detected', fg: COLORS.dimWhite })]),
    ...(below > 0 ? [Text({ content: ` ${below} more below`, fg: COLORS.dimWhite })] : []),
    ...(report.warnings.length > 0
      ? [
          Text({ content: '', fg: COLORS.dimWhite }),
          ...wrapText(`Warnings: ${report.warnings.join(' | ')}`, width, 2).map((line) =>
            Text({ content: truncate(` ${line}`, width), fg: COLORS.dimWhite }),
          ),
        ]
      : []),
  );
}
