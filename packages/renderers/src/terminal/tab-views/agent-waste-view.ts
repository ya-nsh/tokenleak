import type { TokenleakOutput } from '@tokenleak/core';
import { bold, dim } from '../colors';
import { truncateVisible } from '../layout';

function money(value: number | null): string {
  return value === null ? '-' : `$${value.toFixed(4)}`;
}

export function renderAgentWasteView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const report = output.optimization?.agentWaste;
  const lines = [bold('Agent Waste', noColor), ''];
  if (!report) {
    lines.push(dim('No waste report is available for this output.', noColor));
    return lines.join('\n');
  }
  lines.push(`Signals ${report.summary.totalSignals}  High ${report.summary.highSeverity}  Est. savings ${money(report.summary.estimatedSavings)}`);
  lines.push(`Analyzed ${report.summary.analyzedEvents} events / ${report.summary.analyzedSessions} sessions`);
  lines.push('');
  for (const signal of report.signals.slice(0, 12)) {
    lines.push(truncateVisible(
      `[${signal.severity.toUpperCase()}] ${signal.kind}  ${money(signal.estimatedSavings)}  ${signal.title}`,
      width,
    ));
    lines.push(dim(truncateVisible(`  ${signal.evidence.reason}`, width), noColor));
  }
  if (report.signals.length === 0) lines.push(dim('No deterministic waste signals detected.', noColor));
  return lines.join('\n');
}
