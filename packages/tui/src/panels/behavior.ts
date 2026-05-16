import { Box, Text } from '@opentui/core';
import type { AgentBehaviorDiffReport, BehaviorCohortMetrics } from '@tokenleak/core';
import { COLORS, BOLD } from '../lib/theme.js';
import { formatCost, formatTokens, truncate } from '../lib/format.js';

function metricLine(label: string, base: string, compare: string, delta: string) {
  return Text({
    content: `  ${label.padEnd(16)} ${base.padStart(14)}  ${compare.padStart(14)}  ${delta.padStart(12)}`,
    fg: COLORS.white,
  });
}

function fmt(label: keyof BehaviorCohortMetrics, value: number | null): string {
  if (value === null) return '-';
  if (label === 'cost' || label === 'estimatedWasteSavings') return formatCost(value);
  if (label === 'tokens') return formatTokens(value);
  if (label === 'cacheHitRate') return `${(value * 100).toFixed(0)}%`;
  if (label === 'inputPerOutput' || label === 'outputPerDollar' || label === 'modelSwitchesPerSession') return value.toFixed(2);
  return Math.round(value).toLocaleString('en-US');
}

export function createBehaviorPanel(report: AgentBehaviorDiffReport | null) {
  if (!report) {
    return Box(
      { flexDirection: 'column', width: '100%', flexGrow: 1, borderStyle: 'single', borderColor: COLORS.dimWhite, paddingLeft: 1 },
      Text({ content: ' Behavior Diff ', fg: COLORS.amber, attributes: BOLD }),
      Text({ content: 'Need at least one cohort to compare behavior', fg: COLORS.dimWhite }),
    );
  }

  const metrics: Array<[string, keyof BehaviorCohortMetrics]> = [
    ['Events', 'events'],
    ['Sessions', 'sessions'],
    ['Tokens', 'tokens'],
    ['Cost', 'cost'],
    ['Input/Output', 'inputPerOutput'],
    ['Output/$', 'outputPerDollar'],
    ['Cache Hit', 'cacheHitRate'],
    ['Waste Signals', 'wasteSignals'],
  ];

  return Box(
    { flexDirection: 'column', width: '100%', flexGrow: 1, borderStyle: 'single', borderColor: COLORS.dimWhite, paddingLeft: 1, paddingRight: 1 },
    Text({ content: ' Behavior Diff ', fg: COLORS.amber, attributes: BOLD }),
    Text({ content: ` ${report.baseline.selector.label}  vs  ${report.comparison.selector.label}`, fg: COLORS.white, attributes: BOLD }),
    Text({ content: '', fg: COLORS.dimWhite }),
    Text({ content: '  Metric             Baseline         Compare         Delta', fg: COLORS.dimWhite }),
    ...metrics.map(([label, key]) =>
      metricLine(label, fmt(key, report.baseline.metrics[key]), fmt(key, report.comparison.metrics[key]), fmt(key, report.deltas[key])),
    ),
    Text({ content: '', fg: COLORS.dimWhite }),
    Text({ content: ' Takeaways ', fg: COLORS.amber, attributes: BOLD }),
    ...report.takeaways.slice(0, 4).map((takeaway) => Text({ content: `  - ${truncate(takeaway, 72)}`, fg: COLORS.cyan })),
    ...(report.warnings.length > 0
      ? [Text({ content: '', fg: COLORS.dimWhite }), Text({ content: ` Warnings: ${truncate(report.warnings.join(' | '), 74)}`, fg: COLORS.dimWhite })]
      : []),
  );
}
