import {
  DEFAULT_DAYS,
  VERSION,
  buildAgentWasteReport,
  redactWasteReportForExport,
} from '@tokenleak/core';
import type { AgentWasteReport } from '@tokenleak/core';
import { bold, dim } from '@tokenleak/renderers';
import { TokenleakError } from '../errors.js';
import { loadOptimizationInput } from '../providers.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import { formatNullableCost, truncateCell, writeReportOutput } from '../report-output.js';
import { parseOptimizationArgs, printInfoFlag } from '../args.js';
import { initPricing } from '@tokenleak/registry';

export function buildWasteHelpText(): string {
  return [
    `tokenleak waste ${VERSION}`,
    'Detect deterministic agent waste signals with evidence and recipes.',
    '',
    'Usage:',
    '  tokenleak waste [flags]',
    '',
    'Flags:',
    '  -f, --format <format>   Output format: terminal, json',
    '  -s, --since <date>      Start date in YYYY-MM-DD format',
    '  -u, --until <date>      End date in YYYY-MM-DD format',
    `  -d, --days <number>     Number of trailing days to include (default: ${DEFAULT_DAYS})`,
    '  -o, --output <path>     Write output to a file',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --severity <level>  all, high, medium, or low',
    '      --include-prompts   Keep quoted prompt text in JSON output',
    '      --no-color          Disable ANSI colors',
    '',
  ].join('\n');
}

function renderAgentWasteReport(
  report: AgentWasteReport,
  width: number,
  noColor: boolean,
  severity: string = 'all',
): string {
  const termWidth = Math.max(80, width || 80);
  const visible = report.signals.filter(
    (signal) => severity === 'all' || signal.severity === severity,
  );
  const lines = [
    bold('Tokenleak Agent Waste', noColor),
    report.method,
    '',
    `Range: ${report.dateRange.since} to ${report.dateRange.until}`,
    `Signals: ${report.summary.totalSignals}  High: ${report.summary.highSeverity}  Estimated savings: ${formatNullableCost(report.summary.estimatedSavings)}`,
    `Analyzed: ${report.summary.analyzedEvents.toLocaleString('en-US')} events / ${report.summary.analyzedSessions.toLocaleString('en-US')} sessions`,
    '',
  ];

  if (visible.length === 0) {
    lines.push('No waste signals matched the selected filter.');
  } else {
    const headers = ['Severity', 'Kind', 'Title', 'Savings', 'Confidence'];
    const widths = [10, 22, 34, 10, 12];
    const totalWidth = widths.reduce((sum, value) => sum + value, 0) + widths.length + 1;
    widths[2] = Math.max(14, widths[2]! - Math.max(0, totalWidth - termWidth));
    const row = (cells: string[]) =>
      `|${cells.map((cell, index) => ` ${truncateCell(cell, widths[index]! - 2).padEnd(widths[index]! - 2)} `).join('|')}|`;
    lines.push(row(headers));
    lines.push(`|${widths.map((colWidth) => '-'.repeat(colWidth)).join('|')}|`);
    for (const signal of visible.slice(0, 12)) {
      lines.push(
        row([
          signal.severity,
          signal.kind,
          signal.title,
          formatNullableCost(signal.estimatedSavings),
          signal.confidence,
        ]),
      );
      lines.push(dim(`  ${truncateCell(signal.evidence.reason, termWidth - 4)}`, noColor));
    }
  }

  if (report.warnings.length > 0) {
    lines.push('', dim(`Warnings: ${report.warnings.join(' | ')}`, noColor));
  }
  return lines.join('\n');
}

export async function runWaste(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);
  const format = resolveTerminalJsonFormat('waste', cliArgs);
  const severity = typeof cliArgs['severity'] === 'string' ? cliArgs['severity'] : 'all';
  const includePrompts = cliArgs['includePrompts'] === true;
  if (!['all', 'high', 'medium', 'low'].includes(severity)) {
    throw new TokenleakError('tokenleak waste --severity must be all, high, medium, or low');
  }
  const { dateRange, providers } = await loadOptimizationInput(config);
  const events = providers.flatMap((provider) => provider.events ?? []);
  const report = buildAgentWasteReport(providers, events, dateRange);
  const exported = includePrompts ? report : redactWasteReportForExport(report);
  const rendered =
    format === 'json'
      ? JSON.stringify(
          severity === 'all'
            ? exported
            : {
                ...exported,
                signals: exported.signals.filter((signal) => signal.severity === severity),
              },
          null,
          2,
        )
      : renderAgentWasteReport(report, config.width, config.noColor, severity);
  await writeReportOutput(rendered, config.output);
}

/** `tokenleak waste`: `argv` is everything after the subcommand name. */
export async function wasteCommand(argv: string[]): Promise<void> {
  const cliArgs = parseOptimizationArgs(argv);
  if (printInfoFlag(cliArgs, buildWasteHelpText)) return;
  await initPricing();
  await runWaste(cliArgs);
}
