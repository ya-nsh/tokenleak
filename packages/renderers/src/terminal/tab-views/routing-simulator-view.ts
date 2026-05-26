import type { TokenleakOutput } from '@tokenleak/core';
import { bold, dim } from '../colors';
import { truncateVisible } from '../layout';

function formatCompactNumber(value: number): string {
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function renderRoutingSimulatorView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const report = output.optimization?.routingSimulation;
  const lines = [bold('Routing Simulator', noColor), ''];
  if (!report) {
    lines.push(dim('No routing simulation is available for this output.', noColor));
    return lines.join('\n');
  }
  lines.push(`Current ${formatCurrency(report.currentCost)}  ->  Simulated ${formatCurrency(report.simulatedCost)}  Savings ${formatCurrency(report.estimatedSavings)} (${(report.estimatedSavingsPercent * 100).toFixed(1)}%)`);
  lines.push(`Affected ${report.affectedEvents} events / ${formatCompactNumber(report.affectedTokens)} tokens  Strategy ${report.strategy}`);
  lines.push('');
  const candidates = report.candidates.filter((candidate) => (candidate.savings ?? 0) > 0).slice(0, 12);
  if (candidates.length === 0) {
    lines.push(dim('No positive routing candidates found.', noColor));
    return lines.join('\n');
  }
  for (const candidate of candidates) {
    lines.push(truncateVisible(
      `${candidate.ruleId.padEnd(22)} ${candidate.fromModel} -> ${candidate.toModel}  ${formatCurrency(candidate.savings ?? 0)} [${candidate.confidence}]`,
      width,
    ));
  }
  return lines.join('\n');
}
