import { DEFAULT_DAYS, VERSION, buildAgentBehaviorDiffReport } from '@tokenleak/core';
import type { AgentBehaviorDiffReport, BehaviorCohortSelector } from '@tokenleak/core';
import { bold, dim } from '@tokenleak/renderers';
import { computeDateRange } from '../date-range.js';
import { TokenleakError } from '../errors.js';
import {
  emitProviderWarnings,
  loadProviderDataForRange,
  normalizeProviderToken,
  selectAvailableProviders,
} from '../providers.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import {
  formatNullableCost,
  formatNullableNumber,
  truncateCell,
  writeReportOutput,
} from '../report-output.js';
import { parseOptimizationArgs, printInfoFlag } from '../args.js';
import { initPricing } from '@tokenleak/registry';

export function buildBehaviorDiffHelpText(): string {
  return [
    `tokenleak behavior-diff ${VERSION}`,
    'Compare two agent/model/project/provider cohorts.',
    '',
    'Usage:',
    '  tokenleak behavior-diff --provider claude-code,codex [flags]',
    '  tokenleak behavior-diff --model claude-opus-4,claude-sonnet-4 [flags]',
    '',
    'Flags:',
    '  -f, --format <format>   Output format: terminal, json',
    '  -s, --since <date>      Start date in YYYY-MM-DD format',
    '  -u, --until <date>      End date in YYYY-MM-DD format',
    `  -d, --days <number>     Number of trailing days to include (default: ${DEFAULT_DAYS})`,
    '  -o, --output <path>     Write output to a file',
    '      --provider <a,b>    Compare two providers',
    '      --model <a,b>       Compare two models',
    '      --project <a,b>     Compare two project ids',
    '      --repo <a,b>        Compare two repo roots',
    '      --no-color          Disable ANSI colors',
    '',
  ].join('\n');
}

function renderAgentBehaviorDiffReport(
  report: AgentBehaviorDiffReport,
  width: number,
  noColor: boolean,
): string {
  const termWidth = Math.max(80, width || 80);
  const lines = [
    bold('Tokenleak Agent Behavior Diff', noColor),
    report.method,
    '',
    `Range: ${report.dateRange.since} to ${report.dateRange.until}`,
    `${report.baseline.selector.label}  vs  ${report.comparison.selector.label}`,
    '',
  ];
  const rows = [
    [
      'Events',
      report.baseline.metrics.events,
      report.comparison.metrics.events,
      report.deltas.events,
    ],
    [
      'Sessions',
      report.baseline.metrics.sessions,
      report.comparison.metrics.sessions,
      report.deltas.sessions,
    ],
    [
      'Tokens',
      report.baseline.metrics.tokens,
      report.comparison.metrics.tokens,
      report.deltas.tokens,
    ],
    ['Cost', report.baseline.metrics.cost, report.comparison.metrics.cost, report.deltas.cost],
    [
      'Input/Output',
      report.baseline.metrics.inputPerOutput,
      report.comparison.metrics.inputPerOutput,
      report.deltas.inputPerOutput,
    ],
    [
      'Output/$',
      report.baseline.metrics.outputPerDollar,
      report.comparison.metrics.outputPerDollar,
      report.deltas.outputPerDollar,
    ],
    [
      'Cache hit',
      report.baseline.metrics.cacheHitRate,
      report.comparison.metrics.cacheHitRate,
      report.deltas.cacheHitRate,
    ],
    [
      'Waste signals',
      report.baseline.metrics.wasteSignals,
      report.comparison.metrics.wasteSignals,
      report.deltas.wasteSignals,
    ],
  ] as const;
  const widths = [18, 16, 16, 16];
  const row = (cells: string[]) =>
    `|${cells.map((cell, index) => ` ${truncateCell(cell, widths[index]! - 2).padEnd(widths[index]! - 2)} `).join('|')}|`;
  lines.push(row(['Metric', 'Baseline', 'Compare', 'Delta']));
  lines.push(`|${widths.map((colWidth) => '-'.repeat(colWidth)).join('|')}|`);
  for (const [label, base, comp, delta] of rows) {
    const format =
      label === 'Cost'
        ? (value: number | null) => formatNullableCost(value)
        : (value: number | null) =>
            formatNullableNumber(value, label.includes('/') || label === 'Cache hit' ? 2 : 0);
    lines.push(row([label, format(base), format(comp), format(delta)]));
  }
  lines.push('', bold('Takeaways', noColor));
  for (const takeaway of report.takeaways) {
    lines.push(`- ${truncateCell(takeaway, termWidth - 2)}`);
  }
  if (report.warnings.length > 0) {
    lines.push('', dim(`Warnings: ${report.warnings.join(' | ')}`, noColor));
  }
  return lines.join('\n');
}

function splitPair(value: unknown, flag: string): [string, string] | null {
  if (typeof value !== 'string') return null;
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length !== 2) {
    throw new TokenleakError(
      `tokenleak behavior-diff ${flag} expects exactly two comma-separated values`,
    );
  }
  return [parts[0]!, parts[1]!];
}

function resolveBehaviorSelectors(
  cliArgs: Record<string, unknown>,
): [BehaviorCohortSelector, BehaviorCohortSelector] {
  const providerPair = splitPair(cliArgs['provider'], '--provider');
  if (providerPair) {
    return [
      {
        label: providerPair[0],
        dimension: 'provider',
        provider: normalizeProviderToken(providerPair[0]),
      },
      {
        label: providerPair[1],
        dimension: 'provider',
        provider: normalizeProviderToken(providerPair[1]),
      },
    ];
  }
  const modelPair = splitPair(cliArgs['model'], '--model');
  if (modelPair) {
    return [
      { label: modelPair[0], dimension: 'model', model: modelPair[0] },
      { label: modelPair[1], dimension: 'model', model: modelPair[1] },
    ];
  }
  const projectPair = splitPair(cliArgs['project'], '--project');
  if (projectPair) {
    return [
      { label: projectPair[0], dimension: 'project', projectId: projectPair[0] },
      { label: projectPair[1], dimension: 'project', projectId: projectPair[1] },
    ];
  }
  const repoPair = splitPair(cliArgs['repo'], '--repo');
  if (repoPair) {
    return [
      { label: repoPair[0], dimension: 'repo', repoRoot: repoPair[0] },
      { label: repoPair[1], dimension: 'repo', repoRoot: repoPair[1] },
    ];
  }

  throw new TokenleakError(
    'tokenleak behavior-diff needs one selector pair: --provider a,b, --model a,b, --project a,b, or --repo a,b',
  );
}

export async function runBehaviorDiff(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig({
    ...cliArgs,
    provider: undefined,
  });
  const format = resolveTerminalJsonFormat('behavior-diff', cliArgs);
  const selectors = resolveBehaviorSelectors(cliArgs);
  const dateRange = computeDateRange({
    since: config.since,
    until: config.until,
    days: config.days,
  });
  const available = await selectAvailableProviders({ ...config, provider: undefined });
  const { providerDataList } = await loadProviderDataForRange(
    { ...config, provider: undefined },
    dateRange,
    available,
  );
  emitProviderWarnings(providerDataList);
  const events = providerDataList.flatMap((provider) => provider.events ?? []);
  const report = buildAgentBehaviorDiffReport(events, dateRange, selectors[0], selectors[1]);
  const rendered =
    format === 'json'
      ? JSON.stringify(report, null, 2)
      : renderAgentBehaviorDiffReport(report, config.width, config.noColor);
  await writeReportOutput(rendered, config.output);
}

/** `tokenleak behavior-diff`: `argv` is everything after the subcommand name. */
export async function behaviorDiffCommand(argv: string[]): Promise<void> {
  const cliArgs = parseOptimizationArgs(argv);
  if (printInfoFlag(cliArgs, buildBehaviorDiffHelpText)) return;
  await initPricing();
  await runBehaviorDiff(cliArgs);
}
