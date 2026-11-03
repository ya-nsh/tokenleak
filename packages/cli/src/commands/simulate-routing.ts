import { DEFAULT_DAYS, VERSION, buildRoutingSimulationReport, formatUsd } from '@tokenleak/core';
import type { RoutingSimulationReport } from '@tokenleak/core';
import { buildPricingTable, initPricing } from '@tokenleak/registry';
import { bold, dim } from '@tokenleak/renderers';
import { loadOptimizationInput } from '../providers.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import { truncateCell, writeReportOutput } from '../report-output.js';
import { parseOptimizationArgs, printInfoFlag } from '../args.js';

export function buildSimulateRoutingHelpText(): string {
  return [
    `tokenleak simulate-routing ${VERSION}`,
    'Simulate cost impact from routing historical events to cheaper models.',
    '',
    'Usage:',
    '  tokenleak simulate-routing [flags]',
    '',
    'Flags:',
    '  -f, --format <format>   Output format: terminal, json',
    '  -s, --since <date>      Start date in YYYY-MM-DD format',
    '  -u, --until <date>      End date in YYYY-MM-DD format',
    `  -d, --days <number>     Number of trailing days to include (default: ${DEFAULT_DAYS})`,
    '  -o, --output <path>     Write output to a file',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --strategy <name>   conservative, aggressive, or manual',
    '      --no-color          Disable ANSI colors',
    '',
  ].join('\n');
}

function renderRoutingSimulationReport(
  report: RoutingSimulationReport,
  width: number,
  noColor: boolean,
): string {
  const termWidth = Math.max(80, width || 80);
  const lines = [
    bold('Tokenleak Routing Simulator', noColor),
    report.method,
    '',
    `Range: ${report.dateRange.since} to ${report.dateRange.until}  Strategy: ${report.strategy}`,
    `Current: ${formatUsd(report.currentCost)}  Simulated: ${formatUsd(report.simulatedCost)}  Savings: ${formatUsd(report.estimatedSavings)} (${(report.estimatedSavingsPercent * 100).toFixed(1)}%)`,
    `Affected: ${report.affectedEvents.toLocaleString('en-US')} events / ${report.affectedTokens.toLocaleString('en-US')} tokens`,
    '',
  ];

  const positive = report.candidates
    .filter((candidate) => (candidate.savings ?? 0) > 0)
    .slice(0, 12);
  if (positive.length === 0) {
    lines.push('No positive routing candidates found.');
  } else {
    const headers = ['Rule', 'From', 'To', 'Tokens', 'Savings', 'Conf'];
    const widths = [22, 18, 18, 12, 10, 8];
    const totalWidth = widths.reduce((sum, value) => sum + value, 0) + widths.length + 1;
    widths[0] = Math.max(12, widths[0]! - Math.max(0, totalWidth - termWidth));
    const row = (cells: string[]) =>
      `|${cells.map((cell, index) => ` ${truncateCell(cell, widths[index]! - 2).padEnd(widths[index]! - 2)} `).join('|')}|`;
    lines.push(row(headers));
    lines.push(`|${widths.map((colWidth) => '-'.repeat(colWidth)).join('|')}|`);
    for (const candidate of positive) {
      lines.push(
        row([
          candidate.ruleId,
          candidate.fromModel,
          candidate.toModel,
          candidate.tokens.toLocaleString('en-US'),
          formatUsd(candidate.savings ?? 0),
          candidate.confidence,
        ]),
      );
    }
  }

  if (report.warnings.length > 0) {
    lines.push('', dim(`Warnings: ${report.warnings.slice(0, 3).join(' | ')}`, noColor));
  }
  return lines.join('\n');
}

export async function runSimulateRouting(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);
  const format = resolveTerminalJsonFormat('simulate-routing', cliArgs);
  const strategy = typeof cliArgs['strategy'] === 'string' ? cliArgs['strategy'] : 'conservative';
  const { dateRange, providers } = await loadOptimizationInput(config);
  const events = providers.flatMap((provider) => provider.events ?? []);
  const report = buildRoutingSimulationReport(
    events,
    dateRange,
    buildPricingTable(events.map((event) => event.model)),
    { strategy },
  );
  const rendered =
    format === 'json'
      ? JSON.stringify(report, null, 2)
      : renderRoutingSimulationReport(report, config.width, config.noColor);
  await writeReportOutput(rendered, config.output);
}

/** `tokenleak simulate-routing`: `argv` is everything after the subcommand name. */
export async function simulateRoutingCommand(argv: string[]): Promise<void> {
  const cliArgs = parseOptimizationArgs(argv);
  if (printInfoFlag(cliArgs, buildSimulateRoutingHelpText)) return;
  await initPricing();
  await runSimulateRouting(cliArgs);
}
