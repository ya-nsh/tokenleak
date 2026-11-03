import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { defineCommand, runMain } from 'citty';
import {
  DEFAULT_DAYS,
  VERSION,
  buildNutritionReport,
  collectGitOutcomeSignals,
  formatCostWithCompleteness,
  formatTokenCount,
} from '@tokenleak/core';
import type { NutritionReport } from '@tokenleak/core';
import { bold, dim } from '@tokenleak/renderers';
import { loadTokenleakData } from '../data-loader.js';
import { computeDateRange } from '../date-range.js';
import { handleError } from '../errors.js';
import {
  selectAvailableProviders,
  validateProviderSelection,
  writeProviderList,
} from '../providers.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import { formatNullableCost, truncateCell } from '../report-output.js';
import { infoFlagsFromArgv, printInfoFlag, validateCommandFlags } from '../args.js';
import { initPricing } from '@tokenleak/registry';

export function buildNutritionHelpText(): string {
  return [
    `tokenleak nutrition ${VERSION}`,
    'Estimate outcome-adjacent AI coding value by joining token usage with read-only local Git signals.',
    '',
    'Usage:',
    '  tokenleak nutrition [flags]',
    '',
    'Flags:',
    '  -f, --format <format>   Output format: terminal, json',
    '  -s, --since <date>      Start date in YYYY-MM-DD format',
    '  -u, --until <date>      End date in YYYY-MM-DD format',
    `  -d, --days <number>     Number of trailing days to include (default: ${DEFAULT_DAYS})`,
    '  -o, --output <path>     Write output to a file and infer format from extension',
    '  -w, --width <number>    Terminal render width',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --claude            Only include Claude Code',
    '      --codex             Only include Codex',
    '      --cursor           Only include Cursor',
    '      --pi                Only include Pi',
    '      --open-code         Only include OpenCode',
    '      --all-providers     Ignore provider filters and use every available provider',
    '      --list-providers    Show registered providers and aliases',
    '      --no-color          Disable ANSI colors in terminal output',
    '      --help              Show this help',
    '      --version           Show version information',
    '',
    'Examples:',
    '  tokenleak nutrition --days 30',
    '  tokenleak nutrition --format json --output nutrition.json',
    '',
  ].join('\n');
}

function renderNutritionReport(report: NutritionReport, width: number, noColor: boolean): string {
  const termWidth = Math.max(80, width || 80);
  const lines = [
    bold('Tokenleak Nutrition Label', noColor),
    report.method,
    '',
    `Range: ${report.dateRange.since} to ${report.dateRange.until}`,
    `Tokens: ${formatTokenCount(report.totals.tokens)}  Cost: ${formatCostWithCompleteness(report.totals.cost, report.totals.costCompleteness)}  Commits: ${report.totals.commits.toLocaleString('en-US')}  Changed lines: ${formatTokenCount(report.totals.changedLines)}`,
    `Per commit: ${report.totals.tokensPerCommit === null ? '-' : formatTokenCount(report.totals.tokensPerCommit)} tokens / ${formatNullableCost(report.totals.costPerCommit)}`,
    `Per changed line: ${report.totals.tokensPerChangedLine === null ? '-' : formatTokenCount(report.totals.tokensPerChangedLine)} tokens / ${formatNullableCost(report.totals.costPerChangedLine)}`,
    '',
  ];

  if (report.repos.length === 0) {
    lines.push('No event-level usage data found for nutrition analysis.');
    return lines.join('\n');
  }

  const headers = ['Repo', 'Tokens', 'Cost', 'Commits', 'Lines', 'Tok/Commit', '$/Commit'];
  const rows = report.repos.map((repo) => [
    repo.label,
    formatTokenCount(repo.tokens),
    formatCostWithCompleteness(repo.cost, repo.costCompleteness),
    repo.commits.toLocaleString('en-US'),
    formatTokenCount(repo.changedLines),
    repo.tokensPerCommit === null ? '-' : formatTokenCount(repo.tokensPerCommit),
    formatNullableCost(repo.costPerCommit),
  ]);

  const fixedWidths = [22, 12, 10, 9, 10, 12, 10];
  const totalWidth = fixedWidths.reduce((sum, value) => sum + value, 0) + headers.length + 1;
  const repoWidth = Math.max(12, fixedWidths[0]! - Math.max(0, totalWidth - termWidth));
  const widths = [repoWidth, ...fixedWidths.slice(1)];

  function row(cells: string[]): string {
    return `|${cells.map((cell, index) => ` ${truncateCell(cell, widths[index]! - 2).padEnd(widths[index]! - 2)} `).join('|')}|`;
  }

  lines.push(row(headers));
  lines.push(`|${widths.map((colWidth) => '-'.repeat(colWidth)).join('|')}|`);
  for (const cells of rows) {
    lines.push(row(cells));
  }

  if (report.missingOutcomeRepos.length > 0) {
    lines.push('');
    lines.push(
      dim(
        `No Git outcome signal for ${report.missingOutcomeRepos.length} repo(s): ${report.missingOutcomeRepos.map((repo) => basename(repo)).join(', ')}`,
        noColor,
      ),
    );
  }

  return lines.join('\n');
}

async function runNutrition(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);
  const format = resolveTerminalJsonFormat('nutrition', cliArgs);

  validateProviderSelection(config);

  if (config.listProviders) {
    await writeProviderList();
    return;
  }

  const dateRange = computeDateRange({
    since: config.since,
    until: config.until,
    days: config.days,
  });
  const available = await selectAvailableProviders(config);
  const output = await loadTokenleakData(available, dateRange);
  const events = output.providers.flatMap((provider) => provider.events ?? []);
  const outcomeSignals = await collectGitOutcomeSignals(events, dateRange);
  const report = buildNutritionReport(events, outcomeSignals, dateRange);

  const rendered =
    format === 'json'
      ? JSON.stringify(report, null, 2)
      : renderNutritionReport(report, config.width, config.noColor);

  if (config.output) {
    writeFileSync(config.output, rendered);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}

export const nutritionMain = defineCommand({
  meta: {
    name: 'nutrition',
    version: VERSION,
    description: 'Estimate token cost per local Git outcome signal',
  },
  args: {
    format: {
      type: 'string',
      alias: 'f',
      description: 'Output format: terminal, json',
    },
    since: {
      type: 'string',
      alias: 's',
      description: 'Start date (YYYY-MM-DD)',
    },
    until: {
      type: 'string',
      alias: 'u',
      description: 'End date (YYYY-MM-DD), defaults to today',
    },
    days: {
      type: 'string',
      alias: 'd',
      description: `Number of days to look back (default: ${DEFAULT_DAYS}, overridden by --since)`,
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Output file path',
    },
    width: {
      type: 'string',
      alias: 'w',
      description: 'Terminal width (default: 80)',
    },
    noColor: {
      type: 'boolean',
      description: 'Disable ANSI colors',
      default: false,
    },
    provider: {
      type: 'string',
      alias: 'p',
      description: 'Filter to specific provider(s), comma-separated',
    },
    claude: {
      type: 'boolean',
      description: 'Shortcut for --provider claude-code',
      default: false,
    },
    codex: {
      type: 'boolean',
      description: 'Shortcut for --provider codex',
      default: false,
    },
    cursor: {
      type: 'boolean',
      description: 'Shortcut for --provider cursor',
      default: false,
    },
    pi: {
      type: 'boolean',
      description: 'Shortcut for --provider pi',
      default: false,
    },
    openCode: {
      type: 'boolean',
      description: 'Shortcut for --provider open-code',
      default: false,
    },
    allProviders: {
      type: 'boolean',
      description: 'Ignore provider filters and use every available provider',
      default: false,
    },
    listProviders: {
      type: 'boolean',
      description: 'List registered providers and aliases',
      default: false,
    },
  },
  async run({ args }) {
    try {
      const cliArgs: Record<string, unknown> = {};
      if (args.format !== undefined) cliArgs['format'] = args.format;
      if (args.since !== undefined) cliArgs['since'] = args.since;
      if (args.until !== undefined) cliArgs['until'] = args.until;
      if (args.days !== undefined) cliArgs['days'] = Number(args.days);
      if (args.output !== undefined) cliArgs['output'] = args.output;
      if (args.width !== undefined) cliArgs['width'] = Number(args.width);
      if (args.noColor) cliArgs['noColor'] = true;
      if (args.provider !== undefined) cliArgs['provider'] = args.provider;
      if (args.claude) cliArgs['claude'] = true;
      if (args.codex) cliArgs['codex'] = true;
      if (args.cursor) cliArgs['cursor'] = true;
      if (args.pi) cliArgs['pi'] = true;
      if (args.openCode) cliArgs['openCode'] = true;
      if (args.allProviders) cliArgs['allProviders'] = true;
      if (args.listProviders) cliArgs['listProviders'] = true;

      await runNutrition(cliArgs);
    } catch (error: unknown) {
      handleError(error);
    }
  },
});

/** `tokenleak nutrition`: `argv` is everything after the subcommand name. */
export async function nutritionCommand(argv: string[]): Promise<void> {
  // citty reads process.argv, so hand it only this command's flags.
  process.argv = [...process.argv.slice(0, 2), ...argv];
  if (printInfoFlag(infoFlagsFromArgv(argv), buildNutritionHelpText)) return;
  await validateCommandFlags(nutritionMain, argv, 'tokenleak nutrition');
  await initPricing();
  await runMain(nutritionMain);
}
