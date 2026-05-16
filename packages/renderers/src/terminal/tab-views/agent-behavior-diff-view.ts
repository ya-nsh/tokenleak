import type { BehaviorCohortMetrics, TokenleakOutput } from '@tokenleak/core';
import { bold, dim } from '../colors';
import { truncateVisible } from '../layout';

function fmt(key: keyof BehaviorCohortMetrics, value: number | null): string {
  if (value === null) return '-';
  if (key === 'cost' || key === 'estimatedWasteSavings') return `$${value.toFixed(4)}`;
  if (key === 'cacheHitRate') return `${(value * 100).toFixed(0)}%`;
  if (key === 'tokens') return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  if (key === 'inputPerOutput' || key === 'outputPerDollar' || key === 'modelSwitchesPerSession') return value.toFixed(2);
  return Math.round(value).toLocaleString('en-US');
}

export function renderAgentBehaviorDiffView(output: TokenleakOutput, width: number, noColor: boolean): string {
  const report = output.optimization?.behaviorDiff;
  const lines = [bold('Agent Behavior Diff', noColor), ''];
  if (!report) {
    lines.push(dim('No behavior diff is available for this output.', noColor));
    return lines.join('\n');
  }
  lines.push(`${report.baseline.selector.label} vs ${report.comparison.selector.label}`);
  lines.push('');
  const metrics: Array<[string, keyof BehaviorCohortMetrics]> = [
    ['Events', 'events'],
    ['Sessions', 'sessions'],
    ['Tokens', 'tokens'],
    ['Cost', 'cost'],
    ['Input/Output', 'inputPerOutput'],
    ['Output/$', 'outputPerDollar'],
    ['Cache hit', 'cacheHitRate'],
    ['Waste', 'wasteSignals'],
  ];
  for (const [label, key] of metrics) {
    lines.push(`${label.padEnd(14)} ${fmt(key, report.baseline.metrics[key]).padStart(10)}  ${fmt(key, report.comparison.metrics[key]).padStart(10)}  ${fmt(key, report.deltas[key]).padStart(10)}`);
  }
  lines.push('', bold('Takeaways', noColor));
  for (const takeaway of report.takeaways.slice(0, 4)) {
    lines.push(truncateVisible(`- ${takeaway}`, width));
  }
  return lines.join('\n');
}
