import {
  DEFAULT_DAYS,
  VERSION,
  filterBySeverity,
  redactSavingsReportForExport,
} from '@tokenleak/core';
import type { SavingsReport } from '@tokenleak/core';
import { bold, dim } from '@tokenleak/renderers';
import { buildSavings } from '../data-loader.js';
import { TokenleakError } from '../errors.js';
import { loadOptimizationInput } from '../providers.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import { formatNullableCost, truncateCell, writeReportOutput } from '../report-output.js';
import { parseOptimizationArgs, printInfoFlag } from '../args.js';
import { initPricing } from '@tokenleak/registry';

export function buildWasteHelpText(): string {
  return [
    `tokenleak waste ${VERSION}`,
    'Savings findings with evidence and recipes (the same report as --advisor).',
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

/** Rows shown in the terminal table; JSON output keeps every recommendation. */
const MAX_TERMINAL_ROWS = 12;
const SEVERITIES = ['all', 'high', 'medium', 'low'] as const;
type SeverityFilter = (typeof SEVERITIES)[number];

function isSeverityFilter(value: string): value is SeverityFilter {
  return (SEVERITIES as readonly string[]).includes(value);
}

/** The evidence view of the savings report: every finding with its severity and proof. */
function renderWasteView(report: SavingsReport, width: number, noColor: boolean): string {
  const termWidth = Math.max(80, width || 80);
  const visible = report.recommendations;
  const lines = [
    bold('Tokenleak Agent Waste', noColor),
    report.method,
    '',
    `Range: ${report.dateRange.since} to ${report.dateRange.until}`,
    `Findings: ${report.summary.totalRecommendations}  High: ${report.summary.highSeverity}  Estimated savings: ${formatNullableCost(report.summary.estimatedSavings)}`,
    `Analyzed: ${report.summary.analyzedEvents.toLocaleString('en-US')} events / ${report.summary.analyzedSessions.toLocaleString('en-US')} sessions`,
    '',
  ];

  if (visible.length === 0) {
    lines.push('No findings matched the selected filter.');
  } else {
    const headers = ['Severity', 'Kind', 'Title', 'Savings', 'Confidence'];
    const widths = [10, 22, 34, 10, 12];
    const totalWidth = widths.reduce((sum, value) => sum + value, 0) + widths.length + 1;
    widths[2] = Math.max(14, widths[2]! - Math.max(0, totalWidth - termWidth));
    const row = (cells: string[]) =>
      `|${cells.map((cell, index) => ` ${truncateCell(cell, widths[index]! - 2).padEnd(widths[index]! - 2)} `).join('|')}|`;
    lines.push(row(headers));
    lines.push(`|${widths.map((colWidth) => '-'.repeat(colWidth)).join('|')}|`);
    for (const recommendation of visible.slice(0, MAX_TERMINAL_ROWS)) {
      lines.push(
        row([
          recommendation.severity,
          recommendation.kind,
          recommendation.title,
          formatNullableCost(recommendation.estimatedSavings),
          recommendation.confidence,
        ]),
      );
      lines.push(dim(`  ${truncateCell(recommendation.evidence.reason, termWidth - 4)}`, noColor));
    }
    if (visible.length > MAX_TERMINAL_ROWS) {
      lines.push(
        dim(
          `  ...and ${visible.length - MAX_TERMINAL_ROWS} more (--format json lists all)`,
          noColor,
        ),
      );
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
  if (!isSeverityFilter(severity)) {
    throw new TokenleakError('tokenleak waste --severity must be all, high, medium, or low');
  }
  const { dateRange, providers } = await loadOptimizationInput(config);
  const report = filterBySeverity(buildSavings(providers, dateRange), severity);
  const rendered =
    format === 'json'
      ? JSON.stringify(
          cliArgs['includePrompts'] === true ? report : redactSavingsReportForExport(report),
          null,
          2,
        )
      : renderWasteView(report, config.width, config.noColor);
  await writeReportOutput(rendered, config.output);
}

/** `tokenleak waste`: `argv` is everything after the subcommand name. */
export async function wasteCommand(argv: string[]): Promise<void> {
  const cliArgs = parseOptimizationArgs(argv);
  if (printInfoFlag(cliArgs, buildWasteHelpText)) return;
  await initPricing();
  await runWaste(cliArgs);
}
