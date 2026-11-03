import { writeFileSync } from 'node:fs';
import { buildExplainReport } from '@tokenleak/core';
import { loadTokenleakData } from '../data-loader.js';
import { computeDateRange, resolveDayArgument } from '../date-range.js';
import { TokenleakError } from '../errors.js';
import { buildExplainHelpText, renderExplainTerminal } from '../explain.js';
import {
  emitProviderWarnings,
  selectAvailableProviders,
  validateProviderSelection,
} from '../providers.js';
import { resolveConfig, resolveTerminalJsonFormat } from '../report-options.js';
import { infoFlagsFromArgv, printInfoFlag } from '../args.js';
import { initPricing } from '@tokenleak/registry';

export function parseExplainArgs(argv: string[]): {
  date: string;
  cliArgs: Record<string, unknown>;
} {
  if (argv.length === 0 || argv[0]?.startsWith('-')) {
    throw new TokenleakError(
      'tokenleak explain requires a <date> argument: YYYY-MM-DD, "today", or "yesterday"',
    );
  }

  const date = resolveDayArgument('tokenleak explain', argv[0]!);

  const cliArgs: Record<string, unknown> = {};
  let index = 1;

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
      case '--format':
      case '-f':
        if (argv[index + 1] === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        cliArgs['format'] = argv[index + 1]!;
        index += 2;
        break;
      case '--output':
      case '-o':
        if (argv[index + 1] === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        cliArgs['output'] = argv[index + 1]!;
        index += 2;
        break;
      case '--width':
      case '-w':
        if (argv[index + 1] === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        cliArgs['width'] = Number(argv[index + 1]!);
        index += 2;
        break;
      case '--provider':
      case '-p':
        if (argv[index + 1] === undefined) {
          throw new TokenleakError(`${arg} requires a value`);
        }
        cliArgs['provider'] = argv[index + 1]!;
        index += 2;
        break;
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
      case '--noColor':
      case '--no-color':
        cliArgs['noColor'] = true;
        index += 1;
        break;
      default:
        throw new TokenleakError(`Unknown explain flag "${arg}"`);
    }
  }

  return { date, cliArgs };
}

export async function runExplain(date: string, cliArgs: Record<string, unknown>): Promise<void> {
  const config = resolveConfig(cliArgs);
  const format = resolveTerminalJsonFormat('explain', cliArgs);

  validateProviderSelection(config);

  const explainRange = computeDateRange({ until: date, days: 30 });
  const available = await selectAvailableProviders(config);

  if (available.length === 0) {
    throw new TokenleakError('No provider data found');
  }

  const explainOutput = await loadTokenleakData(available, explainRange);
  emitProviderWarnings(explainOutput.providers);
  const report = buildExplainReport(explainOutput.providers, date);
  const rendered =
    format === 'json'
      ? JSON.stringify(report, null, 2)
      : renderExplainTerminal(report, config.width);

  if (config.output) {
    writeFileSync(config.output, rendered);
  } else {
    process.stdout.write(rendered + '\n');
  }
}

/** `tokenleak explain <date>`: `argv` is everything after the subcommand name. */
export async function explainCommand(argv: string[]): Promise<void> {
  // Before parsing: `explain --help` has no date, and the date is required.
  if (printInfoFlag(infoFlagsFromArgv(argv), buildExplainHelpText)) return;
  const { date, cliArgs } = parseExplainArgs(argv);
  await initPricing();
  await runExplain(date, cliArgs);
}
