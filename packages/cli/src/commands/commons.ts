import { readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_DAYS,
  VERSION,
  buildCommonsExport,
  buildCommonsPromptExport,
  inspectCommonsExport,
} from '@tokenleak/core';
import { loadTokenleakData } from '../data-loader.js';
import { computeDateRange } from '../date-range.js';
import { TokenleakError } from '../errors.js';
import { selectAvailableProviders, writeProviderList } from '../providers.js';
import { resolveConfig } from '../report-options.js';
import { copyToClipboard } from '../sharing/index.js';
import { printInfoFlag } from '../args.js';
import { initPricing } from '@tokenleak/registry';

export function buildCommonsHelpText(): string {
  return [
    `tokenleak commons ${VERSION}`,
    'Export or inspect local-only anonymized aggregate usage data.',
    '',
    'Usage:',
    '  tokenleak commons export [flags]',
    '  tokenleak commons prompt [flags]',
    '  tokenleak commons inspect <file>',
    '',
    'Export flags:',
    '  -s, --since <date>      Start date in YYYY-MM-DD format',
    '  -u, --until <date>      End date in YYYY-MM-DD format',
    `  -d, --days <number>     Number of trailing days to include (default: ${DEFAULT_DAYS})`,
    '  -o, --output <path>     Write JSON or Markdown prompt output to a file',
    '  -p, --provider <list>   Provider filter list, comma-separated',
    '      --claude            Only include Claude Code',
    '      --codex             Only include Codex',
    '      --cursor           Only include Cursor',
    '      --pi                Only include Pi',
    '      --open-code         Only include OpenCode',
    '      --all-providers     Ignore provider filters and use every available provider',
    '      --list-providers    Show registered providers and aliases',
    '      --clipboard         Copy prompt output to the clipboard',
    '      --help              Show this help',
    '      --version           Show version information',
    '',
    'Examples:',
    '  tokenleak commons export --days 90 --output commons.json',
    '  tokenleak commons prompt --days 90 --clipboard',
    '  tokenleak commons prompt --provider claude,codex --output tokenleak-llm-prompt.md',
    '  tokenleak commons inspect commons.json',
    '',
  ].join('\n');
}

function parseCommonsExportArgs(
  argv: string[],
  options: { allowClipboard?: boolean; commandName?: string } = {},
): Record<string, unknown> {
  const cliArgs: Record<string, unknown> = {};
  const commandName = options.commandName ?? 'export';
  let index = 0;

  while (index < argv.length) {
    const arg = argv[index]!;
    switch (arg) {
      case '--help':
      case '-h':
        cliArgs['help'] = true;
        index += 1;
        break;
      case '--version':
      case '-v':
        cliArgs['version'] = true;
        index += 1;
        break;
      case '--since':
      case '-s':
      case '--until':
      case '-u':
      case '--days':
      case '-d':
      case '--output':
      case '-o':
      case '--provider':
      case '-p': {
        if (argv[index + 1] === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        const value = argv[index + 1]!;
        const key =
          arg === '--since' || arg === '-s'
            ? 'since'
            : arg === '--until' || arg === '-u'
              ? 'until'
              : arg === '--days' || arg === '-d'
                ? 'days'
                : arg === '--output' || arg === '-o'
                  ? 'output'
                  : 'provider';
        if (key === 'days') {
          const days = Number(value);
          if (!Number.isFinite(days) || days <= 0) {
            throw new TokenleakError(`${arg} must be a positive number`);
          }
          cliArgs[key] = days;
        } else {
          cliArgs[key] = value;
        }
        index += 2;
        break;
      }
      case '--claude':
        cliArgs['claude'] = true;
        index += 1;
        break;
      case '--codex':
        cliArgs['codex'] = true;
        index += 1;
        break;
      case '--cursor':
        cliArgs['cursor'] = true;
        index += 1;
        break;
      case '--pi':
        cliArgs['pi'] = true;
        index += 1;
        break;
      case '--openCode':
      case '--open-code':
        cliArgs['openCode'] = true;
        index += 1;
        break;
      case '--allProviders':
      case '--all-providers':
        cliArgs['allProviders'] = true;
        index += 1;
        break;
      case '--listProviders':
      case '--list-providers':
        cliArgs['listProviders'] = true;
        index += 1;
        break;
      case '--clipboard':
        if (!options.allowClipboard) {
          throw new TokenleakError(`Unknown commons ${commandName} flag "${arg}"`);
        }
        cliArgs['clipboard'] = true;
        index += 1;
        break;
      default:
        throw new TokenleakError(`Unknown commons ${commandName} flag "${arg}"`);
    }
  }

  return cliArgs;
}

export function parseCommonsArgs(
  argv: string[],
):
  | { action: 'export' | 'prompt'; cliArgs: Record<string, unknown> }
  | { action: 'inspect'; file: string } {
  const action = argv[0];
  if (!action || action === '--help' || action === '-h') {
    return { action: 'export', cliArgs: { help: true } };
  }
  if (action === '--version' || action === '-v') {
    return { action: 'export', cliArgs: { version: true } };
  }

  if (action === 'export') {
    return { action: 'export', cliArgs: parseCommonsExportArgs(argv.slice(1)) };
  }

  if (action === 'prompt') {
    return {
      action: 'prompt',
      cliArgs: parseCommonsExportArgs(argv.slice(1), {
        allowClipboard: true,
        commandName: 'prompt',
      }),
    };
  }

  if (action === 'inspect') {
    const file = argv[1];
    if (!file || file.startsWith('-')) {
      throw new TokenleakError('tokenleak commons inspect requires a file path');
    }
    if (argv.length > 2) {
      throw new TokenleakError(`Unknown commons inspect flag "${argv[2]}"`);
    }
    return { action: 'inspect', file };
  }

  throw new TokenleakError(`Unknown commons command "${action}". Use export, prompt, or inspect.`);
}

function renderCommonsInspect(report: ReturnType<typeof inspectCommonsExport>): string {
  const lines = [
    report.valid ? 'Commons export is valid.' : 'Commons export is invalid.',
    `Provider/model rows: ${report.summary.providerModels}`,
    `Day buckets: ${report.summary.dayOfWeekBuckets}`,
    `Hour buckets: ${report.summary.hourOfDayBuckets}`,
    `Project buckets: ${report.summary.projectBuckets}`,
    `Session buckets: ${report.summary.sessionBuckets}`,
  ];

  if (report.errors.length > 0) {
    lines.push('', 'Errors:', ...report.errors.map((error) => `- ${error}`));
  }

  return lines.join('\n');
}

export async function runCommonsExport(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig({ ...cliArgs, format: 'json', more: true });

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
  const commonsExport = buildCommonsExport(output);
  const rendered = JSON.stringify(commonsExport, null, 2);

  if (config.output) {
    writeFileSync(config.output, rendered);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}

export async function runCommonsPrompt(cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig({ ...cliArgs, format: 'json', more: true });

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
  const commonsExport = buildCommonsExport(output);
  const rendered = buildCommonsPromptExport(commonsExport);

  if (config.output) {
    writeFileSync(config.output, rendered);
  } else {
    process.stdout.write(`${rendered}\n`);
  }

  if (config.clipboard) {
    await copyToClipboard(rendered);
    process.stderr.write('Copied LLM analysis prompt to clipboard.\n');
  }
}

export function runCommonsInspect(file: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (error: unknown) {
    throw new TokenleakError(
      error instanceof Error
        ? `Could not read commons export: ${error.message}`
        : 'Could not read commons export.',
    );
  }

  const report = inspectCommonsExport(parsed);
  process.stdout.write(`${renderCommonsInspect(report)}\n`);
}

/** `tokenleak commons <export|inspect|prompt>`: `argv` is everything after the subcommand name. */
export async function commonsCommand(argv: string[]): Promise<void> {
  const parsed = parseCommonsArgs(argv);
  if (parsed.action === 'inspect') {
    runCommonsInspect(parsed.file);
    return;
  }
  if (printInfoFlag(parsed.cliArgs, buildCommonsHelpText)) return;
  await initPricing();
  if (parsed.action === 'prompt') {
    await runCommonsPrompt(parsed.cliArgs);
  } else {
    await runCommonsExport(parsed.cliArgs);
  }
}
